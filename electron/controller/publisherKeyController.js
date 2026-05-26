/**
 * publisherKeyController.js
 *
 * Owns the local publisher signing key + its registry-issued cert.
 *
 * On first call to `getOrCreateLocalKey()`:
 *   1. Generates an Ed25519 keypair in this Node process.
 *   2. Encrypts the private half via Electron `safeStorage` and
 *      persists it in `electron-store` under `publisherKey.private`.
 *   3. POSTs the public half + a machine label to the registry's
 *      /api/publishers/keys/issue-cert endpoint.
 *   4. Verifies the returned cert chains to the bundled registry root
 *      public key before persisting it (defense in depth — a hijacked
 *      registry can't plant a fake cert).
 *   5. Persists the cert + keyId in electron-store under `publisherKey.cert`.
 *
 * On subsequent calls: returns the cached cert/keyId/fingerprint.
 *
 * Storage layout in electron-store (`dash-publisher-key`):
 *   {
 *     "publisherKey": {
 *       "private": <base64 encrypted-blob from safeStorage>,
 *       "publicKey": <base64 Ed25519 pub>,
 *       "fingerprint": <hex sha256>,
 *       "machineLabel": "<os.hostname()>",
 *       "keyId": "<uuid from registry>",
 *       "cert": { body, sig },
 *       "createdAt": "<ISO8601>"
 *     }
 *   }
 *
 * The private key never leaves the main process plaintext. The
 * controller only emits `{keyId, fingerprint, publicKey, cert}` over
 * IPC — the encrypted private blob and the decrypted private key are
 * not exposed to the renderer.
 */
const { app, safeStorage } = require("electron");
const os = require("os");
const crypto = require("crypto");

const {
  generateKeypair,
  signBuffer: signWithKey,
  verifyPublisherCert,
  computeFingerprint,
} = require("../security/publisherCrypto");
const {
  getRegistryRootPublicKey,
} = require("../security/registryRootPublicKey");
const { getStoredToken } = require("./registryAuthController");

const REGISTRY_BASE_URL =
  process.env.DASH_REGISTRY_API_URL ||
  "https://main.d919rwhuzp7rj.amplifyapp.com";

// Lazy-load electron-store so jest can mock it without booting the
// app shell.
let store = null;
function getStore() {
  if (!store) {
    const Store = require("electron-store");
    store = new Store({
      name: "dash-publisher-key",
      // encryptionKey is a defense-in-depth layer on the JSON file
      // itself — the private key inside is independently encrypted
      // via safeStorage (OS keychain).
      encryptionKey: "dash-publisher-v1",
    });
  }
  return store;
}

// Serialize concurrent getOrCreate calls. Without this, two publishes
// firing simultaneously on a machine with no key would each generate
// + register a new key, leaving the second one orphaned.
let inflightGetOrCreate = null;

function readStored() {
  return getStore().get("publisherKey") || null;
}

function writeStored(record) {
  getStore().set("publisherKey", record);
}

function clearStored() {
  getStore().delete("publisherKey");
}

function buildMachineLabel() {
  let host;
  try {
    host = os.hostname();
  } catch {
    host = "unknown-machine";
  }
  return host && host.length > 0 ? host.slice(0, 64) : "unknown-machine";
}

/**
 * Public surface for the renderer. Encrypted private blobs and raw
 * private keys are filtered out — only the keyId / fingerprint /
 * cert metadata leaves the main process.
 */
function publicView(record) {
  if (!record) return null;
  return {
    keyId: record.keyId,
    fingerprint: record.fingerprint,
    publicKey: record.publicKey,
    machineLabel: record.machineLabel,
    createdAt: record.createdAt,
    hasCert: Boolean(record.cert),
    certExpiresAt: record.cert ? record.cert.body.expires_at : null,
  };
}

async function issueCertOnRegistry({ publicKey, machineLabel, token }) {
  const res = await fetch(
    `${REGISTRY_BASE_URL}/api/publishers/keys/issue-cert`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ publicKey, machineLabel }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 409 means a key with this fingerprint is already registered.
    // Both the same-owner and different-owner cases are surfaced as
    // errors; callers (this controller's getOrCreateLocalKey) should
    // refuse to plant a duplicate.
    const err = new Error(data.error || `Cert issuance failed: ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data; // { keyId, fingerprint, cert, createdAt }
}

async function postRevokeOnRegistry({ keyId, token }) {
  const res = await fetch(`${REGISTRY_BASE_URL}/api/publishers/keys/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ keyId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Revoke failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function _getOrCreateImpl() {
  // Already have a key + cert? Return the public view.
  const existing = readStored();
  if (
    existing &&
    existing.private &&
    existing.publicKey &&
    existing.cert &&
    existing.keyId
  ) {
    return { record: existing, generated: false };
  }

  // Need a registry token for the cert request.
  const auth = getStoredToken();
  if (!auth || !auth.token) {
    const err = new Error("Not authenticated with registry");
    err.authRequired = true;
    throw err;
  }

  // Generate keypair.
  const kp = await generateKeypair();
  const fingerprint = computeFingerprint(kp.publicKey);
  const machineLabel = buildMachineLabel();

  // Ask the registry to sign our public key.
  const issued = await issueCertOnRegistry({
    publicKey: kp.publicKey,
    machineLabel,
    token: auth.token,
  });

  // Defense in depth: verify the cert is signed by THE root key we
  // bundle, not just any key the registry happened to return.
  await verifyPublisherCert({
    cert: issued.cert,
    registryRootPublicKey: getRegistryRootPublicKey(),
  });

  // Cross-check fingerprints match what we computed.
  if (issued.fingerprint !== fingerprint) {
    throw new Error(
      "Registry returned a cert with a different fingerprint than the key we sent.",
    );
  }
  if (issued.cert.body.public_key !== kp.publicKey) {
    throw new Error(
      "Registry returned a cert whose public_key does not match the key we sent.",
    );
  }

  // Encrypt the private key for at-rest storage. If safeStorage isn't
  // available (headless / unusual env), refuse to persist — never
  // store the private key plaintext.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Local key encryption is not available on this system (Electron safeStorage unavailable). " +
        "Refusing to persist publisher private key.",
    );
  }
  const encryptedPriv = safeStorage
    .encryptString(kp.privateKey)
    .toString("base64");

  const record = {
    private: encryptedPriv,
    publicKey: kp.publicKey,
    fingerprint,
    machineLabel,
    keyId: issued.keyId,
    cert: issued.cert,
    createdAt: issued.createdAt || new Date().toISOString(),
  };
  writeStored(record);
  return { record, generated: true };
}

/**
 * Get the local publisher signing key, generating + registering one
 * with the registry on first call. Returns the public view (no
 * encrypted blob, no plaintext private key).
 *
 * Concurrent callers share the same in-flight promise so first-time
 * keygen races resolve to a single registration.
 */
async function getOrCreateLocalKey() {
  if (!inflightGetOrCreate) {
    inflightGetOrCreate = _getOrCreateImpl().finally(() => {
      inflightGetOrCreate = null;
    });
  }
  const { record, generated } = await inflightGetOrCreate;
  return { ...publicView(record), generated };
}

/**
 * Sign a buffer with the local publisher key. If no key exists yet,
 * one is auto-created (same path as getOrCreateLocalKey). Returns the
 * signature + the publisher cert + the keyId — exactly the shape the
 * publish endpoint expects.
 */
async function signZipBuffer(zipBytes) {
  const { record } = inflightGetOrCreate
    ? await inflightGetOrCreate
    : await (async () => {
        // ensure key exists
        await getOrCreateLocalKey();
        // re-read from disk so we have the encrypted private blob
        return { record: readStored() };
      })();
  if (!record || !record.private) {
    throw new Error("Publisher key unavailable after getOrCreate");
  }
  // Decrypt the private key for the brief signing window. The
  // plaintext private key never leaves this scope.
  const encryptedBuf = Buffer.from(record.private, "base64");
  const privateKey = safeStorage.decryptString(encryptedBuf);
  const signature = await signWithKey({
    bytes: zipBytes,
    privateKey,
  });
  return {
    signature,
    publisherCert: record.cert,
    publisherKeyId: record.keyId,
    publisherFingerprint: record.fingerprint,
  };
}

/**
 * Revoke the local key on the registry + clear it from disk so the
 * next publish auto-generates a fresh one.
 */
async function revokeLocalKey() {
  const existing = readStored();
  if (!existing || !existing.keyId) {
    return { ok: true, revoked: false, reason: "No local key" };
  }
  const auth = getStoredToken();
  if (!auth || !auth.token) {
    const err = new Error("Not authenticated with registry");
    err.authRequired = true;
    throw err;
  }
  await postRevokeOnRegistry({ keyId: existing.keyId, token: auth.token });
  clearStored();
  return { ok: true, revoked: true, keyId: existing.keyId };
}

/**
 * Surface a summary of the current local key (or null if none).
 * Used by the UI to render "Your signing key" info in Settings.
 */
function describeLocalKey() {
  return publicView(readStored());
}

module.exports = {
  getOrCreateLocalKey,
  signZipBuffer,
  revokeLocalKey,
  describeLocalKey,
  // exposed for tests + the registryApiController extension
  _readStored: readStored,
  _clearStored: clearStored,
};

/**
 * publisherCrypto.js
 *
 * Ed25519 crypto helpers for the publisher-signing flow.
 *
 * Mirror of `dash-registry/src/lib/crypto.ts` — kept byte-for-byte
 * compatible on the wire (canonical-JSON over the same `body` shape,
 * Ed25519-sign(sha256(zip)) for zip signatures, hex-sha256 fingerprint)
 * so a cert issued by the registry verifies here and vice-versa.
 *
 * Cert format:
 *   {
 *     body: {
 *       v: 1,
 *       publisher_id: "<cognito sub>",
 *       public_key:  "<base64 Ed25519>",
 *       fingerprint: "<hex sha256(public_key bytes)>",
 *       issued_at:   "<ISO8601>",
 *       expires_at:  "<ISO8601>"
 *     },
 *     sig: "<base64 Ed25519 sig over canonical-JSON(body)>"
 *   }
 */
const ed = require("@noble/ed25519");
const { sha256, sha512 } = require("@noble/hashes/sha2.js");

// @noble/ed25519 v3 requires the consumer to wire SHA-512 explicitly.
ed.hashes.sha512 = sha512;

// --- Encoding helpers ---

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonical JSON: sort keys recursively, no whitespace. Two verifiers
 * compute byte-identical strings from semantically equal payloads.
 * Never sign over an unspecified-ordering JSON.stringify().
 */
function canonicalJsonStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalJsonStringify(value[k]),
  );
  return "{" + parts.join(",") + "}";
}

// --- Fingerprints ---

/**
 * Fingerprint of a public key: hex(sha256(base64-decoded key bytes)).
 * Stable identifier for the registry's `ByFingerprint` GSI lookup at
 * install-time revocation check.
 */
function computeFingerprint(publicKeyBase64) {
  return bytesToHex(sha256(base64ToBytes(publicKeyBase64)));
}

// --- Key generation ---

async function generateKeypair() {
  const privateBytes = ed.utils.randomSecretKey();
  const publicBytes = await ed.getPublicKeyAsync(privateBytes);
  return {
    privateKey: bytesToBase64(privateBytes),
    publicKey: bytesToBase64(publicBytes),
  };
}

// --- Cert verification (defense in depth: verify the registry's
//     response before persisting it) ---

/**
 * Verify a publisher cert against the registry root public key.
 * Throws on failure (bad sig, expired, version mismatch, fingerprint
 * mismatch). Returns the verified body on success.
 */
async function verifyPublisherCert({ cert, registryRootPublicKey, now }) {
  const actualNow = now || new Date();
  if (!cert || typeof cert !== "object") {
    throw new Error("Cert payload missing");
  }
  if (!cert.body || cert.body.v !== 1) {
    throw new Error(`Unsupported cert version: ${cert.body && cert.body.v}`);
  }
  if (computeFingerprint(cert.body.public_key) !== cert.body.fingerprint) {
    throw new Error("Cert fingerprint does not match public key");
  }
  if (new Date(cert.body.expires_at) < actualNow) {
    throw new Error("Cert has expired");
  }
  const message = new TextEncoder().encode(canonicalJsonStringify(cert.body));
  const sigBytes = base64ToBytes(cert.sig);
  const rootPubBytes = base64ToBytes(registryRootPublicKey);
  const ok = await ed.verifyAsync(sigBytes, message, rootPubBytes);
  if (!ok) throw new Error("Cert signature verification failed");
  return cert.body;
}

// --- ZIP signing ---

/**
 * Sign a buffer with an Ed25519 private key. Returns the base64
 * signature over `sha256(bytes)` — the wire format the registry's
 * verifier expects.
 */
async function signBuffer({ bytes, privateKey }) {
  const digest = sha256(bytes);
  const privBytes = base64ToBytes(privateKey);
  const sigBytes = await ed.signAsync(digest, privBytes);
  return bytesToBase64(sigBytes);
}

/**
 * Verify a buffer signature against a public key. Used in tests.
 */
async function verifyBufferSignature({ bytes, signature, publicKey }) {
  const digest = sha256(bytes);
  const sigBytes = base64ToBytes(signature);
  const pubBytes = base64ToBytes(publicKey);
  return ed.verifyAsync(sigBytes, digest, pubBytes);
}

module.exports = {
  canonicalJsonStringify,
  computeFingerprint,
  generateKeypair,
  verifyPublisherCert,
  signBuffer,
  verifyBufferSignature,
  // internal helpers — exported for tests
  _internal: { bytesToBase64, base64ToBytes, bytesToHex, sha256 },
};

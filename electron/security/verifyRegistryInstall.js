/**
 * verifyRegistryInstall.js
 *
 * Install-time signature verification for registry-downloaded
 * packages. The download response from the registry now carries
 * `{zipSignature, publisherCert, publisherKeyId, publisherFingerprint}`
 * alongside the pre-signed S3 URL; this module is the single
 * chokepoint where both widget and theme install paths verify those
 * fields against the bundled trust anchor BEFORE extracting the ZIP.
 *
 * Three modes via DASH_REGISTRY_VERIFY_SIGNED_INSTALL env var:
 *   - "off":    skip verification entirely (legacy / sandbox).
 *   - "warn":   log + proceed on failure (default during rollout).
 *   - "strict": refuse on failure.
 *
 * Verification sequence (any failure short-circuits per mode):
 *   1. If all signing fields are absent → "unsigned" case.
 *      In `off` and `warn` modes: proceed. In `strict`: refuse with
 *      reason `UNSIGNED_PACKAGE`.
 *   2. Cert chain: cert.sig verifies against the bundled registry
 *      root public key (defense against a hijacked registry serving
 *      a fake cert).
 *   3. ZIP signature: zipSignature verifies against the publisher's
 *      public key from cert.body.public_key.
 *   4. Revocation: GET /api/publishers/keys/revocation-status?
 *      fingerprint=… returns `known:true, revoked:false`. Network
 *      failure or any non-200 response is treated as `revoked` —
 *      we refuse to install when we can't confirm a key is good.
 *
 * The verifier never throws unless it would in `strict` mode. The
 * return value tells callers what happened so they can log it or
 * surface to the UI:
 *   { verified: boolean, reason: string|null, mode: string, warnings: string[] }
 */
const {
  verifyPublisherCert,
  verifyBufferSignature,
  verifyManifestSignature,
  CURRENT_MANIFEST_SIGNATURE_KEYID,
} = require("./publisherCrypto");
const { getRegistryRootPublicKey } = require("./registryRootPublicKey");

const VALID_MODES = new Set(["off", "warn", "strict"]);

function readMode() {
  const raw = (process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL || "warn")
    .trim()
    .toLowerCase();
  if (!VALID_MODES.has(raw)) {
    console.warn(
      `[verifyRegistryInstall] Unknown mode "${raw}", falling back to "warn".`,
    );
    return "warn";
  }
  return raw;
}

const REGISTRY_BASE_URL =
  process.env.DASH_REGISTRY_API_URL ||
  "https://main.d919rwhuzp7rj.amplifyapp.com";

/**
 * `revocationFetcher` is injected by tests; production uses the
 * built-in fetch against the live registry. Centralized so the
 * verifier's logic is fully exercised without mocking globals.
 */
async function defaultRevocationFetcher(fingerprint) {
  const url = `${REGISTRY_BASE_URL}/api/publishers/keys/revocation-status?fingerprint=${encodeURIComponent(fingerprint)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Revocation check HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Apply the current mode to a failure. In `strict` we throw; in
 * `warn` we log + return a non-verified result so the caller can
 * decide to surface a UI warning. `off` mode never reaches this.
 */
function applyMode(mode, reason, warnings) {
  if (mode === "strict") {
    const err = new Error(`Install verification failed: ${reason}`);
    err.code = "INSTALL_VERIFICATION_FAILED";
    err.reason = reason;
    throw err;
  }
  // warn
  console.warn(`[verifyRegistryInstall] (warn mode) ${reason}`);
  return { verified: false, reason, mode, warnings };
}

/**
 * Verify a downloaded package's signing metadata.
 *
 * @param {Object} args
 * @param {Buffer|Uint8Array} args.zipBuffer
 * @param {string|null} args.zipSignature       base64 Ed25519 sig
 * @param {Object|null} args.publisherCert      { body, sig }
 * @param {string|null} args.publisherKeyId
 * @param {string|null} args.publisherFingerprint  hex sha256
 * @param {{ revocationFetcher?: (fp: string) => Promise<{known, revoked, revokedAt}> }} [opts]
 * @returns {Promise<{verified, reason, mode, warnings}>}
 */
async function verifyDownloadedPackage(args, opts = {}) {
  const mode = readMode();
  const warnings = [];

  if (mode === "off") {
    return { verified: true, reason: null, mode, warnings };
  }

  const {
    zipBuffer,
    zipSignature,
    publisherCert,
    publisherKeyId,
    publisherFingerprint,
  } = args || {};

  // Unsigned case: all signing fields absent.
  const haveAllFields =
    zipSignature && publisherCert && publisherKeyId && publisherFingerprint;
  if (!haveAllFields) {
    return applyMode(mode, "UNSIGNED_PACKAGE", warnings);
  }

  if (!zipBuffer || zipBuffer.length === 0) {
    return applyMode(mode, "EMPTY_ZIP_BUFFER", warnings);
  }

  // 1. Cert chains to bundled root.
  let verifiedBody;
  try {
    verifiedBody = await verifyPublisherCert({
      cert: publisherCert,
      registryRootPublicKey: getRegistryRootPublicKey(),
    });
  } catch (err) {
    return applyMode(mode, `CERT_INVALID: ${err.message || err}`, warnings);
  }

  // 2. The cert's fingerprint must match the one the download
  //    response advertised. Catches a misaligned download payload
  //    even when the cert itself is valid.
  if (verifiedBody.fingerprint !== publisherFingerprint) {
    return applyMode(
      mode,
      `FINGERPRINT_MISMATCH: response declared ${publisherFingerprint} but cert is for ${verifiedBody.fingerprint}`,
      warnings,
    );
  }

  // 3. ZIP signature verifies against the publisher's public key.
  let sigOk = false;
  try {
    sigOk = await verifyBufferSignature({
      bytes:
        zipBuffer instanceof Uint8Array && !Buffer.isBuffer(zipBuffer)
          ? zipBuffer
          : new Uint8Array(zipBuffer),
      signature: zipSignature,
      publicKey: verifiedBody.public_key,
    });
  } catch (err) {
    return applyMode(
      mode,
      `ZIP_SIGNATURE_ERROR: ${err.message || err}`,
      warnings,
    );
  }
  if (!sigOk) {
    return applyMode(mode, "ZIP_SIGNATURE_INVALID", warnings);
  }

  // 4. Revocation check. Strict-fail on network errors — we refuse
  //    to install when we can't confirm the key is unrevoked. (In
  //    warn mode this is downgraded to a log + proceed by applyMode.)
  const fetcher = opts.revocationFetcher || defaultRevocationFetcher;
  let revStatus;
  try {
    revStatus = await fetcher(publisherFingerprint);
  } catch (err) {
    return applyMode(
      mode,
      `REVOCATION_CHECK_FAILED: ${err.message || err}`,
      warnings,
    );
  }
  if (revStatus.revoked) {
    return applyMode(
      mode,
      `KEY_REVOKED: ${publisherFingerprint} revoked at ${revStatus.revokedAt || "unknown"}`,
      warnings,
    );
  }
  if (revStatus.known === false) {
    // The cert chained to the root but the fingerprint isn't in the
    // publisher_keys table — suggests a forged or out-of-band cert.
    return applyMode(mode, "KEY_NOT_REGISTERED", warnings);
  }

  return { verified: true, reason: null, mode, warnings };
}

/**
 * Phase 5D (audit P1 #24): verify the signature on the /download
 * response BODY before the caller consumes downloadUrl / zipSignature /
 * publisherCert from it. Closes the MITM vector where a swapped
 * response could redirect the installer to a different ZIP signed by
 * an attacker-controlled (but still legitimate) publisher cert.
 *
 * Same off/warn/strict modes as the zip+cert verifier above — the
 * env var `DASH_REGISTRY_VERIFY_SIGNED_INSTALL` controls both.
 *
 * The signature is computed server-side over the canonical JSON of
 * the body minus the two signature fields themselves. Verification
 * here re-canonicalizes the same way and checks against the bundled
 * registry root public key.
 *
 * @param {object} args
 * @param {object} args.responseBody — the full parsed JSON body from /download
 * @returns {Promise<{verified, reason, mode, warnings}>}
 */
async function verifyDownloadManifest({ responseBody }) {
  const mode = readMode();
  const warnings = [];

  if (mode === "off") {
    return { verified: true, reason: null, mode, warnings };
  }

  if (!responseBody || typeof responseBody !== "object") {
    return applyMode(mode, "MANIFEST_BODY_MISSING", warnings);
  }

  const signature = responseBody.manifest_signature;
  const keyid = responseBody.manifest_signature_keyid;

  // Unsigned case: legacy registry deployments that haven't been
  // upgraded yet won't include these fields. In `warn` mode we log
  // + proceed so the rollout doesn't break existing installs; in
  // `strict` mode we refuse.
  if (!signature || !keyid) {
    return applyMode(mode, "UNSIGNED_MANIFEST", warnings);
  }

  // Today only one root key is bundled. When rotation lands, this
  // becomes a lookup over an array of trusted public keys keyed by
  // keyid; unknown keyid → fail closed.
  if (keyid !== CURRENT_MANIFEST_SIGNATURE_KEYID) {
    return applyMode(
      mode,
      `MANIFEST_SIGNATURE_UNKNOWN_KEYID: ${keyid}`,
      warnings,
    );
  }

  let ok = false;
  try {
    ok = await verifyManifestSignature({
      body: responseBody,
      signature,
      registryRootPublicKey: getRegistryRootPublicKey(),
    });
  } catch (err) {
    return applyMode(
      mode,
      `MANIFEST_SIGNATURE_ERROR: ${err.message || err}`,
      warnings,
    );
  }
  if (!ok) {
    return applyMode(mode, "MANIFEST_SIGNATURE_INVALID", warnings);
  }

  return { verified: true, reason: null, mode, warnings };
}

module.exports = {
  verifyDownloadedPackage,
  verifyDownloadManifest,
  _readMode: readMode,
};

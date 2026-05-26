/**
 * verifyDownloadManifest.test.js
 *
 * Phase 5D (audit P1 #24): tests for the install-time manifest
 * signature verifier. Mirrors the off/warn/strict mode pattern of
 * the existing verifyDownloadedPackage suite — fresh require per
 * mode so DASH_REGISTRY_VERIFY_SIGNED_INSTALL is re-read.
 *
 * Run: `node --test electron/security/verifyDownloadManifest.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const ed = require("@noble/ed25519");
const { sha512 } = require("@noble/hashes/sha2.js");
ed.hashes.sha512 = sha512;

const {
  generateKeypair,
  canonicalJsonStringify,
  _internal,
} = require("./publisherCrypto");

let testRootPriv;
let testRootPub;
let warnSpyCalls;
let originalWarn;

function installWarnSpy() {
  warnSpyCalls = [];
  originalWarn = console.warn;
  console.warn = (...args) => {
    warnSpyCalls.push(args);
  };
}

function uninstallWarnSpy() {
  if (originalWarn) {
    console.warn = originalWarn;
    originalWarn = null;
  }
}

function loadFresh() {
  // Force a fresh require so the verifier re-reads
  // DASH_REGISTRY_VERIFY_SIGNED_INSTALL on each call.
  delete require.cache[require.resolve("./verifyRegistryInstall")];
  return require("./verifyRegistryInstall");
}

async function signManifestForTests(body) {
  const stripped = { ...body };
  delete stripped.manifest_signature;
  delete stripped.manifest_signature_keyid;
  const message = new TextEncoder().encode(canonicalJsonStringify(stripped));
  const sigBytes = await ed.signAsync(
    message,
    _internal.base64ToBytes(testRootPriv),
  );
  return _internal.bytesToBase64(sigBytes);
}

function makeBody() {
  return {
    downloadUrl: "https://s3.example/widget.zip",
    version: "1.0.0",
    packageId: "@ai-built/foo",
    zipSignature: "sig",
    publisherCert: { body: {}, sig: "x" },
    publisherKeyId: "key",
    publisherFingerprint: "fp",
  };
}

test.before(async () => {
  const root = await generateKeypair();
  testRootPriv = root.privateKey;
  testRootPub = root.publicKey;
});

test.beforeEach(() => {
  process.env.DASH_REGISTRY_ROOT_PUBLIC_KEY = testRootPub;
  delete process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL;
});

test.afterEach(() => {
  uninstallWarnSpy();
});

test("verifyDownloadManifest: skips verification entirely in off mode", async () => {
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "off";
  const { verifyDownloadManifest } = loadFresh();
  const result = await verifyDownloadManifest({ responseBody: makeBody() });
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.mode, "off");
});

test("verifyDownloadManifest: verifies a clean signed body in strict mode", async () => {
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
  const body = makeBody();
  body.manifest_signature = await signManifestForTests(body);
  body.manifest_signature_keyid = "v1";
  const { verifyDownloadManifest } = loadFresh();
  const result = await verifyDownloadManifest({ responseBody: body });
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.reason, null);
});

test("verifyDownloadManifest: rejects a tampered downloadUrl in strict mode", async () => {
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
  const body = makeBody();
  body.manifest_signature = await signManifestForTests(body);
  body.manifest_signature_keyid = "v1";
  body.downloadUrl = "https://evil.example/malware.zip";
  const { verifyDownloadManifest } = loadFresh();
  await assert.rejects(
    () => verifyDownloadManifest({ responseBody: body }),
    /MANIFEST_SIGNATURE_INVALID/,
  );
});

test("verifyDownloadManifest: rejects a tampered publisherCert in strict mode", async () => {
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
  const body = makeBody();
  body.manifest_signature = await signManifestForTests(body);
  body.manifest_signature_keyid = "v1";
  body.publisherCert = { body: { fingerprint: "stolen" }, sig: "evil" };
  const { verifyDownloadManifest } = loadFresh();
  await assert.rejects(
    () => verifyDownloadManifest({ responseBody: body }),
    /MANIFEST_SIGNATURE_INVALID/,
  );
});

test("verifyDownloadManifest: rejects an unknown keyid in strict mode", async () => {
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
  const body = makeBody();
  body.manifest_signature = await signManifestForTests(body);
  body.manifest_signature_keyid = "v99";
  const { verifyDownloadManifest } = loadFresh();
  await assert.rejects(
    () => verifyDownloadManifest({ responseBody: body }),
    /MANIFEST_SIGNATURE_UNKNOWN_KEYID/,
  );
});

test("verifyDownloadManifest: refuses an unsigned manifest in strict mode", async () => {
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
  const { verifyDownloadManifest } = loadFresh();
  await assert.rejects(
    () => verifyDownloadManifest({ responseBody: makeBody() }),
    /UNSIGNED_MANIFEST/,
  );
});

test("verifyDownloadManifest: warns + proceeds for unsigned manifest in warn mode", async () => {
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "warn";
  installWarnSpy();
  const { verifyDownloadManifest } = loadFresh();
  const result = await verifyDownloadManifest({ responseBody: makeBody() });
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.reason, "UNSIGNED_MANIFEST");
  assert.strictEqual(result.mode, "warn");
  assert.ok(warnSpyCalls.length > 0, "expected console.warn to be called");
});

test("verifyDownloadManifest: rejects a missing responseBody in strict mode", async () => {
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
  const { verifyDownloadManifest } = loadFresh();
  await assert.rejects(
    () => verifyDownloadManifest({ responseBody: null }),
    /MANIFEST_BODY_MISSING/,
  );
});

test("verifyDownloadManifest: round-trips with signature fields already attached", async () => {
  // Verifier must strip signature fields before canonicalizing,
  // matching the signer's behavior. A body that round-trips through
  // serialization (signature attached, then re-verified) passes.
  process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
  const body = makeBody();
  body.manifest_signature = await signManifestForTests(body);
  body.manifest_signature_keyid = "v1";
  const { verifyDownloadManifest } = loadFresh();
  const result = await verifyDownloadManifest({ responseBody: { ...body } });
  assert.strictEqual(result.verified, true);
});

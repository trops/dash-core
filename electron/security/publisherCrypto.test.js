/**
 * Tests for publisherCrypto.js — verify the wire-format invariants we
 * promised the registry-side counterpart.
 */
const {
  canonicalJsonStringify,
  computeFingerprint,
  generateKeypair,
  signBuffer,
  verifyBufferSignature,
  verifyPublisherCert,
  _internal,
} = require("./publisherCrypto");
const ed = require("@noble/ed25519");
const { sha256, sha512 } = require("@noble/hashes/sha2.js");

ed.hashes.sha512 = sha512;

// Helper: build a fully-signed test cert.
async function buildTestCert({ registryPriv, publisherPub, publisherId }) {
  const fingerprint = computeFingerprint(publisherPub);
  const body = {
    v: 1,
    publisher_id: publisherId,
    public_key: publisherPub,
    fingerprint,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  };
  const message = new TextEncoder().encode(canonicalJsonStringify(body));
  const sigBytes = await ed.signAsync(
    message,
    _internal.base64ToBytes(registryPriv),
  );
  return { body, sig: _internal.bytesToBase64(sigBytes) };
}

describe("canonicalJsonStringify", () => {
  test("sorts keys recursively + no whitespace", () => {
    const a = canonicalJsonStringify({ b: 2, a: 1, c: { y: 2, x: 1 } });
    const b = canonicalJsonStringify({ c: { x: 1, y: 2 }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"c":{"x":1,"y":2}}');
  });

  test("preserves array order", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("computeFingerprint", () => {
  test("deterministic", () => {
    const pk = _internal.bytesToBase64(new Uint8Array(32).fill(7));
    expect(computeFingerprint(pk)).toBe(computeFingerprint(pk));
  });

  test("64-char lowercase hex", () => {
    const pk = _internal.bytesToBase64(new Uint8Array(32).fill(7));
    expect(computeFingerprint(pk)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("generateKeypair", () => {
  test("32-byte Ed25519 keys, unique per call", async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    expect(Buffer.from(a.privateKey, "base64").length).toBe(32);
    expect(Buffer.from(a.publicKey, "base64").length).toBe(32);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

describe("signBuffer + verifyBufferSignature", () => {
  test("round-trip", async () => {
    const kp = await generateKeypair();
    const bytes = new TextEncoder().encode("pretend this is a zip");
    const sig = await signBuffer({ bytes, privateKey: kp.privateKey });
    const ok = await verifyBufferSignature({
      bytes,
      signature: sig,
      publicKey: kp.publicKey,
    });
    expect(ok).toBe(true);
  });

  test("rejects a signature over different bytes", async () => {
    const kp = await generateKeypair();
    const a = new TextEncoder().encode("zip A");
    const b = new TextEncoder().encode("zip B");
    const sig = await signBuffer({ bytes: a, privateKey: kp.privateKey });
    const ok = await verifyBufferSignature({
      bytes: b,
      signature: sig,
      publicKey: kp.publicKey,
    });
    expect(ok).toBe(false);
  });
});

describe("verifyPublisherCert", () => {
  test("happy path", async () => {
    const root = await generateKeypair();
    const pub = await generateKeypair();
    const cert = await buildTestCert({
      registryPriv: root.privateKey,
      publisherPub: pub.publicKey,
      publisherId: "user-abc",
    });
    const body = await verifyPublisherCert({
      cert,
      registryRootPublicKey: root.publicKey,
    });
    expect(body.publisher_id).toBe("user-abc");
  });

  test("rejects wrong-root signature", async () => {
    const realRoot = await generateKeypair();
    const fakeRoot = await generateKeypair();
    const pub = await generateKeypair();
    const cert = await buildTestCert({
      registryPriv: fakeRoot.privateKey,
      publisherPub: pub.publicKey,
      publisherId: "user-abc",
    });
    await expect(
      verifyPublisherCert({
        cert,
        registryRootPublicKey: realRoot.publicKey,
      }),
    ).rejects.toThrow(/signature verification failed/);
  });

  test("rejects tampered body", async () => {
    const root = await generateKeypair();
    const pub = await generateKeypair();
    const cert = await buildTestCert({
      registryPriv: root.privateKey,
      publisherPub: pub.publicKey,
      publisherId: "user-abc",
    });
    cert.body.publisher_id = "user-attacker";
    await expect(
      verifyPublisherCert({
        cert,
        registryRootPublicKey: root.publicKey,
      }),
    ).rejects.toThrow(/signature verification failed/);
  });

  test("rejects expired cert", async () => {
    const root = await generateKeypair();
    const pub = await generateKeypair();
    const cert = await buildTestCert({
      registryPriv: root.privateKey,
      publisherPub: pub.publicKey,
      publisherId: "user-abc",
    });
    cert.body.expires_at = new Date(Date.now() - 1000).toISOString();
    // Re-sign so the signature is valid but the body says expired —
    // verifyPublisherCert should still reject on expiry check.
    const message = new TextEncoder().encode(canonicalJsonStringify(cert.body));
    const sigBytes = await ed.signAsync(
      message,
      _internal.base64ToBytes(root.privateKey),
    );
    cert.sig = _internal.bytesToBase64(sigBytes);
    await expect(
      verifyPublisherCert({
        cert,
        registryRootPublicKey: root.publicKey,
      }),
    ).rejects.toThrow(/expired/);
  });
});

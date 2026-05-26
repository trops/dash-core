/**
 * Tests for verifyRegistryInstall.js — install-time verification
 * across the three feature-flag modes (off/warn/strict).
 *
 * The bundled trust anchor is overridden via DASH_REGISTRY_ROOT_PUBLIC_KEY
 * so we sign certs with a test root. The revocation fetcher is injected
 * via opts so we don't touch the network.
 */
const ed = require("@noble/ed25519");
const { sha512 } = require("@noble/hashes/sha2.js");
ed.hashes.sha512 = sha512;

const {
  generateKeypair,
  canonicalJsonStringify,
  computeFingerprint,
  signBuffer,
  _internal,
} = require("./publisherCrypto");

let testRootPriv;
let testRootPub;

async function buildCert({ rootPriv, publisherId, publisherPub, expiresAt }) {
  const body = {
    v: 1,
    publisher_id: publisherId,
    public_key: publisherPub,
    fingerprint: computeFingerprint(publisherPub),
    issued_at: new Date().toISOString(),
    expires_at:
      expiresAt || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  };
  const message = new TextEncoder().encode(canonicalJsonStringify(body));
  const sigBytes = await ed.signAsync(
    message,
    _internal.base64ToBytes(rootPriv),
  );
  return { body, sig: _internal.bytesToBase64(sigBytes) };
}

function loadFresh() {
  jest.resetModules();
  return require("./verifyRegistryInstall");
}

beforeAll(async () => {
  const root = await generateKeypair();
  testRootPriv = root.privateKey;
  testRootPub = root.publicKey;
});

beforeEach(() => {
  process.env.DASH_REGISTRY_ROOT_PUBLIC_KEY = testRootPub;
  delete process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("off mode", () => {
  it("skips verification entirely", async () => {
    process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "off";
    const { verifyDownloadedPackage } = loadFresh();
    const result = await verifyDownloadedPackage({});
    expect(result.verified).toBe(true);
    expect(result.mode).toBe("off");
  });
});

describe("warn mode (default)", () => {
  it("returns verified:false on unsigned package but does not throw", async () => {
    const { verifyDownloadedPackage } = loadFresh();
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = await verifyDownloadedPackage({
      zipBuffer: Buffer.from("zip"),
      zipSignature: null,
      publisherCert: null,
      publisherKeyId: null,
      publisherFingerprint: null,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("UNSIGNED_PACKAGE");
    expect(result.mode).toBe("warn");
    expect(spy).toHaveBeenCalled();
  });

  it("verifies a fully-signed package end-to-end", async () => {
    const { verifyDownloadedPackage } = loadFresh();
    const publisher = await generateKeypair();
    const cert = await buildCert({
      rootPriv: testRootPriv,
      publisherId: "user-abc",
      publisherPub: publisher.publicKey,
    });
    const zipBuffer = Buffer.from("pretend this is a zip");
    const signature = await signBuffer({
      bytes: new Uint8Array(zipBuffer),
      privateKey: publisher.privateKey,
    });
    const fingerprint = computeFingerprint(publisher.publicKey);

    const result = await verifyDownloadedPackage(
      {
        zipBuffer,
        zipSignature: signature,
        publisherCert: cert,
        publisherKeyId: "key-001",
        publisherFingerprint: fingerprint,
      },
      {
        revocationFetcher: async () => ({
          known: true,
          revoked: false,
          revokedAt: null,
          fingerprint,
        }),
      },
    );
    expect(result.verified).toBe(true);
    expect(result.reason).toBeNull();
  });
});

describe("strict mode", () => {
  it("throws on unsigned package", async () => {
    process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
    const { verifyDownloadedPackage } = loadFresh();
    await expect(
      verifyDownloadedPackage({
        zipBuffer: Buffer.from("zip"),
        zipSignature: null,
        publisherCert: null,
        publisherKeyId: null,
        publisherFingerprint: null,
      }),
    ).rejects.toMatchObject({
      code: "INSTALL_VERIFICATION_FAILED",
      reason: "UNSIGNED_PACKAGE",
    });
  });

  it("throws when cert chains to a different root", async () => {
    process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
    const { verifyDownloadedPackage } = loadFresh();
    const fakeRoot = await generateKeypair();
    const publisher = await generateKeypair();
    const cert = await buildCert({
      rootPriv: fakeRoot.privateKey,
      publisherId: "user-abc",
      publisherPub: publisher.publicKey,
    });
    const zipBuffer = Buffer.from("zip");
    const signature = await signBuffer({
      bytes: new Uint8Array(zipBuffer),
      privateKey: publisher.privateKey,
    });
    const fingerprint = computeFingerprint(publisher.publicKey);
    await expect(
      verifyDownloadedPackage({
        zipBuffer,
        zipSignature: signature,
        publisherCert: cert,
        publisherKeyId: "key-001",
        publisherFingerprint: fingerprint,
      }),
    ).rejects.toMatchObject({ reason: /CERT_INVALID/ });
  });

  it("throws when zip signature is wrong", async () => {
    process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
    const { verifyDownloadedPackage } = loadFresh();
    const publisher = await generateKeypair();
    const cert = await buildCert({
      rootPriv: testRootPriv,
      publisherId: "user-abc",
      publisherPub: publisher.publicKey,
    });
    const zipBuffer = Buffer.from("zip A");
    // Sign DIFFERENT bytes so the sig won't verify against zipBuffer.
    const signature = await signBuffer({
      bytes: new Uint8Array(Buffer.from("zip B")),
      privateKey: publisher.privateKey,
    });
    const fingerprint = computeFingerprint(publisher.publicKey);
    await expect(
      verifyDownloadedPackage({
        zipBuffer,
        zipSignature: signature,
        publisherCert: cert,
        publisherKeyId: "key-001",
        publisherFingerprint: fingerprint,
      }),
    ).rejects.toMatchObject({ reason: "ZIP_SIGNATURE_INVALID" });
  });

  it("throws when the key is revoked", async () => {
    process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
    const { verifyDownloadedPackage } = loadFresh();
    const publisher = await generateKeypair();
    const cert = await buildCert({
      rootPriv: testRootPriv,
      publisherId: "user-abc",
      publisherPub: publisher.publicKey,
    });
    const zipBuffer = Buffer.from("zip");
    const signature = await signBuffer({
      bytes: new Uint8Array(zipBuffer),
      privateKey: publisher.privateKey,
    });
    const fingerprint = computeFingerprint(publisher.publicKey);
    await expect(
      verifyDownloadedPackage(
        {
          zipBuffer,
          zipSignature: signature,
          publisherCert: cert,
          publisherKeyId: "key-001",
          publisherFingerprint: fingerprint,
        },
        {
          revocationFetcher: async () => ({
            known: true,
            revoked: true,
            revokedAt: "2026-06-01T00:00:00Z",
            fingerprint,
          }),
        },
      ),
    ).rejects.toMatchObject({ reason: /KEY_REVOKED/ });
  });

  it("throws when revocation fetch errors (strict-fail)", async () => {
    process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
    const { verifyDownloadedPackage } = loadFresh();
    const publisher = await generateKeypair();
    const cert = await buildCert({
      rootPriv: testRootPriv,
      publisherId: "user-abc",
      publisherPub: publisher.publicKey,
    });
    const zipBuffer = Buffer.from("zip");
    const signature = await signBuffer({
      bytes: new Uint8Array(zipBuffer),
      privateKey: publisher.privateKey,
    });
    const fingerprint = computeFingerprint(publisher.publicKey);
    await expect(
      verifyDownloadedPackage(
        {
          zipBuffer,
          zipSignature: signature,
          publisherCert: cert,
          publisherKeyId: "key-001",
          publisherFingerprint: fingerprint,
        },
        {
          revocationFetcher: async () => {
            throw new Error("network unreachable");
          },
        },
      ),
    ).rejects.toMatchObject({ reason: /REVOCATION_CHECK_FAILED/ });
  });

  it("throws when revocation reports the key isn't known", async () => {
    process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "strict";
    const { verifyDownloadedPackage } = loadFresh();
    const publisher = await generateKeypair();
    const cert = await buildCert({
      rootPriv: testRootPriv,
      publisherId: "user-abc",
      publisherPub: publisher.publicKey,
    });
    const zipBuffer = Buffer.from("zip");
    const signature = await signBuffer({
      bytes: new Uint8Array(zipBuffer),
      privateKey: publisher.privateKey,
    });
    const fingerprint = computeFingerprint(publisher.publicKey);
    await expect(
      verifyDownloadedPackage(
        {
          zipBuffer,
          zipSignature: signature,
          publisherCert: cert,
          publisherKeyId: "key-001",
          publisherFingerprint: fingerprint,
        },
        {
          revocationFetcher: async () => ({
            known: false,
            revoked: false,
            revokedAt: null,
            fingerprint,
          }),
        },
      ),
    ).rejects.toMatchObject({ reason: "KEY_NOT_REGISTERED" });
  });
});

describe("unknown mode value", () => {
  it("falls back to warn", async () => {
    process.env.DASH_REGISTRY_VERIFY_SIGNED_INSTALL = "lenient-ish-please";
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { verifyDownloadedPackage } = loadFresh();
    const result = await verifyDownloadedPackage({
      zipBuffer: Buffer.from("zip"),
      zipSignature: null,
      publisherCert: null,
      publisherKeyId: null,
      publisherFingerprint: null,
    });
    expect(result.mode).toBe("warn");
    expect(spy).toHaveBeenCalled();
  });
});

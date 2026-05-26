/**
 * publisherKeyController.test.js
 *
 * Validates the publisher-key flow:
 *   - first call to getOrCreateLocalKey generates, registers with the
 *     registry, verifies the cert against the bundled root, and
 *     persists encrypted via safeStorage
 *   - subsequent calls reuse the cached key + cert
 *   - signZipBuffer returns the expected fields
 *   - revokeLocalKey hits the registry + clears local
 *   - cert returned with the wrong root signature is rejected
 *   - safeStorage unavailable → refuses to persist plaintext
 *
 * Uses jest.mock to inject electron + electron-store + the auth
 * controller. The crypto primitives stay real so we actually exercise
 * the cert-verification path end-to-end.
 */

const ed = require("@noble/ed25519");
const { sha512 } = require("@noble/hashes/sha2.js");
ed.hashes.sha512 = sha512;

const {
  generateKeypair,
  canonicalJsonStringify,
  computeFingerprint,
  _internal,
} = require("../security/publisherCrypto");

// ---------------------------------------------------------------------------
// jest mocks — set up before requiring the controller
// ---------------------------------------------------------------------------

let safeStorageAvailable = true;
let inMemoryStore = {};
let mockToken = "test-token";

jest.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  safeStorage: {
    isEncryptionAvailable: () => safeStorageAvailable,
    // Identity-style encrypt for testing — real OS keychain is
    // exercised by Electron, not by us.
    encryptString: (str) => Buffer.from("ENC:" + str, "utf8"),
    decryptString: (buf) => {
      const s = Buffer.from(buf).toString("utf8");
      if (!s.startsWith("ENC:"))
        throw new Error("Cannot decrypt non-encrypted value");
      return s.slice(4);
    },
  },
}));

jest.mock(
  "electron-store",
  () =>
    class MockStore {
      get(key) {
        return inMemoryStore[key];
      }
      set(key, value) {
        inMemoryStore[key] = value;
      }
      delete(key) {
        delete inMemoryStore[key];
      }
    },
);

jest.mock("./registryAuthController", () => ({
  getStoredToken: () => (mockToken ? { token: mockToken } : null),
}));

// ---------------------------------------------------------------------------
// Test root keypair — override the bundled trust anchor via env var.
// Setting this BEFORE requiring the controller so getRegistryRootPublicKey()
// resolves to our test key.
// ---------------------------------------------------------------------------
let testRootPriv;
let testRootPub;

async function buildSignedCert({
  rootPriv,
  publisherId,
  publisherPub,
  fingerprint,
  expiresAt,
}) {
  const body = {
    v: 1,
    publisher_id: publisherId,
    public_key: publisherPub,
    fingerprint: fingerprint || computeFingerprint(publisherPub),
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

function resetState() {
  inMemoryStore = {};
  safeStorageAvailable = true;
  mockToken = "test-token";
}

// Require fresh controller per test so the module-level `inflightGetOrCreate`
// and lazy `store` reset between cases.
function loadFreshController() {
  jest.resetModules();
  return require("./publisherKeyController");
}

beforeAll(async () => {
  const root = await generateKeypair();
  testRootPriv = root.privateKey;
  testRootPub = root.publicKey;
  process.env.DASH_REGISTRY_ROOT_PUBLIC_KEY = testRootPub;
});

beforeEach(() => {
  resetState();
});

describe("getOrCreateLocalKey", () => {
  it("generates, registers, verifies cert, and persists on first call", async () => {
    const ctrl = loadFreshController();

    let observedPublicKey = null;
    global.fetch = jest.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      observedPublicKey = body.publicKey;
      const cert = await buildSignedCert({
        rootPriv: testRootPriv,
        publisherId: "user-abc",
        publisherPub: body.publicKey,
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          keyId: "test-key-id",
          fingerprint: computeFingerprint(body.publicKey),
          cert,
          createdAt: "2026-05-25T00:00:00Z",
        }),
      };
    });

    const view = await ctrl.getOrCreateLocalKey();
    expect(view.keyId).toBe("test-key-id");
    expect(view.publicKey).toBe(observedPublicKey);
    expect(view.hasCert).toBe(true);
    expect(view.generated).toBe(true);
    expect(view.fingerprint).toBe(computeFingerprint(observedPublicKey));

    // Encrypted private blob is persisted; cert + keyId are too.
    const stored = inMemoryStore.publisherKey;
    expect(stored.private).toBeTruthy();
    // Decrypt the stored blob and confirm we get the private key back.
    const { safeStorage } = require("electron");
    const decrypted = safeStorage.decryptString(
      Buffer.from(stored.private, "base64"),
    );
    expect(decrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(stored.keyId).toBe("test-key-id");
    expect(stored.publicKey).toBe(observedPublicKey);
    expect(stored.cert.body.publisher_id).toBe("user-abc");
  });

  it("reuses the cached key on the second call (no second fetch)", async () => {
    const ctrl = loadFreshController();

    let fetchCount = 0;
    global.fetch = jest.fn(async (url, options) => {
      fetchCount++;
      const body = JSON.parse(options.body);
      const cert = await buildSignedCert({
        rootPriv: testRootPriv,
        publisherId: "user-abc",
        publisherPub: body.publicKey,
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          keyId: "test-key-id",
          fingerprint: computeFingerprint(body.publicKey),
          cert,
        }),
      };
    });

    const a = await ctrl.getOrCreateLocalKey();
    const b = await ctrl.getOrCreateLocalKey();
    expect(fetchCount).toBe(1);
    expect(a.keyId).toBe(b.keyId);
    expect(b.generated).toBe(false);
  });

  it("rejects a cert signed by the wrong root", async () => {
    const ctrl = loadFreshController();
    const fakeRoot = await generateKeypair();

    global.fetch = jest.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      // Sign with fakeRoot — controller should reject this against
      // its bundled trust anchor (testRootPub).
      const cert = await buildSignedCert({
        rootPriv: fakeRoot.privateKey,
        publisherId: "user-abc",
        publisherPub: body.publicKey,
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          keyId: "test-key-id",
          fingerprint: computeFingerprint(body.publicKey),
          cert,
        }),
      };
    });

    await expect(ctrl.getOrCreateLocalKey()).rejects.toThrow(
      /signature verification failed/,
    );
    // No state persisted on rejection.
    expect(inMemoryStore.publisherKey).toBeUndefined();
  });

  it("refuses to persist when safeStorage is unavailable", async () => {
    safeStorageAvailable = false;
    const ctrl = loadFreshController();

    global.fetch = jest.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      const cert = await buildSignedCert({
        rootPriv: testRootPriv,
        publisherId: "user-abc",
        publisherPub: body.publicKey,
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          keyId: "test-key-id",
          fingerprint: computeFingerprint(body.publicKey),
          cert,
        }),
      };
    });

    await expect(ctrl.getOrCreateLocalKey()).rejects.toThrow(
      /safeStorage unavailable/,
    );
    expect(inMemoryStore.publisherKey).toBeUndefined();
  });

  it("throws authRequired when not logged in", async () => {
    mockToken = null;
    const ctrl = loadFreshController();
    await expect(ctrl.getOrCreateLocalKey()).rejects.toMatchObject({
      authRequired: true,
      message: /Not authenticated/,
    });
  });
});

describe("signZipBuffer", () => {
  it("returns signature + cert + keyId for a buffer", async () => {
    const ctrl = loadFreshController();
    let observedPublicKey = null;
    global.fetch = jest.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      observedPublicKey = body.publicKey;
      const cert = await buildSignedCert({
        rootPriv: testRootPriv,
        publisherId: "user-abc",
        publisherPub: body.publicKey,
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          keyId: "test-key-id",
          fingerprint: computeFingerprint(body.publicKey),
          cert,
        }),
      };
    });

    const bytes = new TextEncoder().encode("fake zip");
    const result = await ctrl.signZipBuffer(bytes);
    expect(result.signature).toBeTruthy();
    expect(result.publisherKeyId).toBe("test-key-id");
    expect(result.publisherCert.body.public_key).toBe(observedPublicKey);
    expect(result.publisherFingerprint).toBe(
      computeFingerprint(observedPublicKey),
    );
  });
});

describe("revokeLocalKey", () => {
  it("posts to the registry and clears local on success", async () => {
    const ctrl = loadFreshController();
    let revokeCalled = false;
    global.fetch = jest.fn(async (url, options) => {
      if (url.includes("/issue-cert")) {
        const body = JSON.parse(options.body);
        const cert = await buildSignedCert({
          rootPriv: testRootPriv,
          publisherId: "user-abc",
          publisherPub: body.publicKey,
        });
        return {
          ok: true,
          status: 201,
          json: async () => ({
            keyId: "test-key-id",
            fingerprint: computeFingerprint(body.publicKey),
            cert,
          }),
        };
      }
      if (url.includes("/revoke")) {
        revokeCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            keyId: "test-key-id",
            revokedAt: "2026-06-01T00:00:00Z",
            alreadyRevoked: false,
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await ctrl.getOrCreateLocalKey();
    expect(inMemoryStore.publisherKey).toBeTruthy();
    const r = await ctrl.revokeLocalKey();
    expect(r.ok).toBe(true);
    expect(r.revoked).toBe(true);
    expect(revokeCalled).toBe(true);
    expect(inMemoryStore.publisherKey).toBeUndefined();
  });

  it("no-ops when there is no local key", async () => {
    const ctrl = loadFreshController();
    const r = await ctrl.revokeLocalKey();
    expect(r.ok).toBe(true);
    expect(r.revoked).toBe(false);
  });
});

describe("describeLocalKey", () => {
  it("returns null when no key is stored", () => {
    const ctrl = loadFreshController();
    expect(ctrl.describeLocalKey()).toBeNull();
  });
});

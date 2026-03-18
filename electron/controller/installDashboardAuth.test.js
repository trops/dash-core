/**
 * installDashboardAuth.test.js
 *
 * Unit tests for registry download auth in installDashboardFromRegistry:
 *   - Auth header inclusion in download request (DASH-134)
 *   - 401 response handling with token clear + authRequired flag (DASH-134)
 *   - Missing token returns authRequired (DASH-134)
 *   - Auto-retry after successful auth (DASH-136 UI flow)
 *
 * Uses Node.js built-in test module with source re-evaluation to mock
 * dependencies (same pattern as webSocketController.test.js).
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Mutable mock state — reset in beforeEach
// ---------------------------------------------------------------------------
let mockStoredToken = null;
let clearTokenCalled = false;
let lastFetchUrl = null;
let lastFetchOptions = null;
let mockFetchResponse = null;
let mockGetPackageResult = null;

// ---------------------------------------------------------------------------
// Load the controller with mocked dependencies
// ---------------------------------------------------------------------------
function loadController() {
  const source = fs.readFileSync(
    path.join(__dirname, "dashboardConfigController.js"),
    "utf8",
  );

  const mockRegistryAuthController = {
    getStoredToken: () => mockStoredToken,
    clearToken: () => {
      clearTokenCalled = true;
    },
  };

  const mockRegistryController = {
    searchRegistry: () => [],
    getPackage: async () => mockGetPackageResult,
  };

  // Minimal mocks for modules we don't exercise in these tests
  const mockElectron = {
    app: { getPath: () => "/tmp" },
    dialog: { showOpenDialog: async () => ({ canceled: true }) },
  };

  const mockFetch = async (url, options) => {
    lastFetchUrl = url;
    lastFetchOptions = options;
    return mockFetchResponse;
  };

  const projectRoot = path.resolve(__dirname, "../..");

  const customRequire = (mod) => {
    if (mod === "electron") return mockElectron;
    if (mod === "./registryAuthController") return mockRegistryAuthController;
    if (mod === "./registryController") return mockRegistryController;
    if (mod === "./themeController") return { getThemeRegistry: () => [] };
    if (mod === "../utils/file") return { getFileContents: () => null };
    if (mod === "../widgetRegistry") return { validateZipEntries: () => {} };
    // Schema modules are safe to load from disk
    if (mod.startsWith("../schema/")) return require(mod);
    if (mod === "path") return path;
    // Mock adm-zip — our tests never reach ZIP parsing
    if (mod === "adm-zip")
      return class MockAdmZip {
        constructor() {}
        getEntries() {
          return [];
        }
      };
    return require(mod);
  };

  const mod = { exports: {} };
  const fn = new Function(
    "require",
    "module",
    "exports",
    "console",
    "fetch",
    source,
  );
  fn(customRequire, mod, mod.exports, console, mockFetch);
  return mod.exports;
}

const controller = loadController();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MOCK_PKG = {
  name: "test-dashboard",
  scope: "@trops",
  version: "1.0.0",
};

function mockOkResponse() {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function mock401Response() {
  return {
    ok: false,
    status: 401,
    statusText: "Unauthorized",
  };
}

function mock500Response() {
  return {
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("installDashboardFromRegistry — auth header", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
  });

  it("includes Authorization header when token is available", async () => {
    mockStoredToken = { token: "my-secret-token" };
    // Response will fail at ZIP parsing, but we only care about the fetch call
    mockFetchResponse = mockOkResponse();

    try {
      await controller.installDashboardFromRegistry(
        null,
        "app1",
        "test-dashboard",
      );
    } catch {
      // Expected — ZIP parsing will fail on empty buffer
    }

    assert.ok(lastFetchOptions, "fetch should have been called");
    assert.equal(
      lastFetchOptions.headers["Authorization"],
      "Bearer my-secret-token",
      "Authorization header should contain the token",
    );
  });

  it("constructs correct download URL from registry package", async () => {
    mockStoredToken = { token: "tok" };
    mockFetchResponse = mockOkResponse();

    try {
      await controller.installDashboardFromRegistry(
        null,
        "app1",
        "test-dashboard",
      );
    } catch {
      // ZIP parsing failure expected
    }

    assert.ok(lastFetchUrl, "fetch URL should be set");
    assert.ok(
      lastFetchUrl.includes("/api/packages/"),
      "URL should include /api/packages/ path",
    );
    assert.ok(
      lastFetchUrl.includes("test-dashboard"),
      "URL should include package name",
    );
    assert.ok(
      lastFetchUrl.includes("version=1.0.0"),
      "URL should include version",
    );
  });

  it("does not include Authorization header when token object has no token field", async () => {
    mockStoredToken = {}; // truthy object, but no .token
    mockFetchResponse = mockOkResponse();

    try {
      await controller.installDashboardFromRegistry(
        null,
        "app1",
        "test-dashboard",
      );
    } catch {
      // ZIP parsing failure expected
    }

    assert.ok(lastFetchOptions, "fetch should have been called");
    assert.equal(
      lastFetchOptions.headers["Authorization"],
      undefined,
      "Authorization header should not be set when token field is missing",
    );
  });
});

describe("installDashboardFromRegistry — missing token", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
  });

  it("returns authRequired when no token is stored", async () => {
    mockStoredToken = null;

    const result = await controller.installDashboardFromRegistry(
      null,
      "app1",
      "test-dashboard",
    );

    assert.equal(result.success, false);
    assert.equal(result.authRequired, true);
    assert.ok(
      result.error.toLowerCase().includes("not authenticated"),
      "Error message should indicate not authenticated",
    );
  });

  it("does not call fetch when no token is stored", async () => {
    mockStoredToken = null;

    await controller.installDashboardFromRegistry(
      null,
      "app1",
      "test-dashboard",
    );

    assert.equal(
      lastFetchUrl,
      null,
      "fetch should not be called when token is missing",
    );
  });
});

describe("installDashboardFromRegistry — 401 handling", () => {
  beforeEach(() => {
    mockStoredToken = { token: "expired-token" };
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
  });

  it("returns authRequired on 401 response", async () => {
    mockFetchResponse = mock401Response();

    const result = await controller.installDashboardFromRegistry(
      null,
      "app1",
      "test-dashboard",
    );

    assert.equal(result.success, false);
    assert.equal(result.authRequired, true);
  });

  it("clears token on 401 response", async () => {
    mockFetchResponse = mock401Response();

    await controller.installDashboardFromRegistry(
      null,
      "app1",
      "test-dashboard",
    );

    assert.equal(clearTokenCalled, true, "clearToken should be called on 401");
  });

  it("returns appropriate error message on 401", async () => {
    mockFetchResponse = mock401Response();

    const result = await controller.installDashboardFromRegistry(
      null,
      "app1",
      "test-dashboard",
    );

    assert.ok(
      result.error.toLowerCase().includes("expired") ||
        result.error.toLowerCase().includes("sign in"),
      "Error message should mention expired auth or sign in",
    );
  });

  it("does not clear token on non-401 errors", async () => {
    mockFetchResponse = mock500Response();

    const result = await controller.installDashboardFromRegistry(
      null,
      "app1",
      "test-dashboard",
    );

    assert.equal(result.success, false);
    assert.equal(
      clearTokenCalled,
      false,
      "clearToken should NOT be called on 500",
    );
    assert.equal(
      result.authRequired,
      undefined,
      "authRequired should not be set on 500",
    );
  });
});

describe("installDashboardFromRegistry — retry flow contract", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
  });

  it("succeeds on retry when token becomes available", async () => {
    // First call: no token → authRequired
    mockStoredToken = null;
    const first = await controller.installDashboardFromRegistry(
      null,
      "app1",
      "test-dashboard",
    );
    assert.equal(first.authRequired, true, "First call should require auth");

    // Simulate auth completion: token is now available
    mockStoredToken = { token: "fresh-token" };
    mockFetchResponse = mockOkResponse();

    // Second call (auto-retry) — will fail at ZIP parsing but proves
    // the function proceeds past the auth gate with the new token
    let result;
    try {
      result = await controller.installDashboardFromRegistry(
        null,
        "app1",
        "test-dashboard",
      );
    } catch {
      // ZIP parsing failure is acceptable here
    }

    assert.ok(lastFetchUrl, "fetch should be called on retry");
    assert.equal(
      lastFetchOptions.headers["Authorization"],
      "Bearer fresh-token",
      "Retry should use the fresh token",
    );
  });

  it("401 → clear → retry with new token", async () => {
    // First call: expired token → 401 → clearToken + authRequired
    mockStoredToken = { token: "stale-token" };
    mockFetchResponse = mock401Response();

    const first = await controller.installDashboardFromRegistry(
      null,
      "app1",
      "test-dashboard",
    );
    assert.equal(first.authRequired, true);
    assert.equal(clearTokenCalled, true, "Stale token should be cleared");

    // Simulate re-auth
    clearTokenCalled = false;
    mockStoredToken = { token: "new-token-after-reauth" };
    mockFetchResponse = mockOkResponse();

    try {
      await controller.installDashboardFromRegistry(
        null,
        "app1",
        "test-dashboard",
      );
    } catch {
      // ZIP parsing failure expected
    }

    assert.equal(
      lastFetchOptions.headers["Authorization"],
      "Bearer new-token-after-reauth",
      "Retry should use the new token after re-auth",
    );
    assert.equal(
      clearTokenCalled,
      false,
      "clearToken should NOT be called on successful fetch",
    );
  });
});

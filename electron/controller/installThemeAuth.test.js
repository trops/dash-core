/**
 * installThemeAuth.test.js
 *
 * Unit tests for registry download auth in installThemeFromRegistry:
 *   - Auth header inclusion in download request (DASH-141)
 *   - 401 response handling with token clear + authRequired flag (DASH-142)
 *   - Missing token returns authRequired (DASH-141)
 *   - Auto-retry after successful auth (DASH-144 UI flow)
 *   - Pipeline failure scenarios after auth gate (DASH-150)
 *   - Happy path end-to-end with realistic mock data (DASH-150)
 *   - Scope/name mismatch and URL encoding edge cases (DASH-155)
 *   - Additional HTTP error scenarios (DASH-155)
 *   - Registry metadata and save verification (DASH-155)
 *
 * Uses Node.js built-in test module with source re-evaluation to mock
 * dependencies (same pattern as installDashboardAuth.test.js).
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
let mockAdmZipEntries = [];
let lastSavedTheme = null;
let mockSaveResult = null;

// ---------------------------------------------------------------------------
// Load the controller with mocked dependencies
// ---------------------------------------------------------------------------
function loadController() {
  const source = fs.readFileSync(
    path.join(__dirname, "themeRegistryController.js"),
    "utf8",
  );

  const mockRegistryAuthController = {
    getAuthStatus: () => ({ authenticated: !!mockStoredToken }),
    getRegistryProfile: async () => null,
    getStoredToken: () => mockStoredToken,
    clearToken: () => {
      clearTokenCalled = true;
    },
  };

  const mockRegistryController = {
    searchRegistry: () => [],
    getPackage: async () => mockGetPackageResult,
  };

  const mockRegistryApiController = {
    publishPackage: async () => ({ success: true }),
  };

  const mockThemeController = {
    saveThemeForApplication: (_win, _appId, _key, themeData) => {
      lastSavedTheme = { key: _key, data: themeData };
      return mockSaveResult || { themes: { [_key]: themeData } };
    },
    getThemeRegistry: () => [],
    listThemesForApplication: () => ({ themes: {} }),
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

  const customRequire = (mod) => {
    if (mod === "electron") return mockElectron;
    if (mod === "./registryAuthController") return mockRegistryAuthController;
    if (mod === "./registryController") return mockRegistryController;
    if (mod === "./registryApiController") return mockRegistryApiController;
    if (mod === "./themeController") return mockThemeController;
    if (mod === "path") return path;
    if (mod === "fs") return fs;
    if (mod === "adm-zip")
      return class MockAdmZip {
        constructor() {}
        getEntries() {
          return mockAdmZipEntries;
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

/** Realistic mock package matching actual registry API response format */
const MOCK_PKG = {
  name: "ocean-depth",
  scope: "@trops",
  version: "1.2.0",
  displayName: "Ocean Depth",
  type: "theme",
  category: "general",
  author: "johng",
  description: "A deep blue ocean-inspired theme",
  tags: ["dark", "blue", "ocean"],
  icon: "palette",
  colors: {
    primary: "#1e40af",
    secondary: "#1e3a5f",
    tertiary: "#0f172a",
    neutral: "#334155",
  },
  publishedAt: "2026-03-10T14:30:00.000Z",
};

/** Realistic theme data as stored in a .theme.json inside the ZIP */
const MOCK_THEME_DATA = {
  name: "Ocean Depth",
  primary: "blue",
  secondary: "slate",
  tertiary: "gray",
  neutral: "zinc",
  colors: {
    primary: "#1e40af",
    secondary: "#1e3a5f",
    tertiary: "#0f172a",
    neutral: "#334155",
  },
  mode: "dark",
  fontFamily: "Inter, sans-serif",
};

/** Create a mock ZIP entry that returns theme JSON from getData() */
function createMockThemeEntry(entryName, data) {
  return {
    entryName,
    getData: () => Buffer.from(JSON.stringify(data), "utf-8"),
  };
}

function mockOkResponse() {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "application/zip" },
    arrayBuffer: async () => new ArrayBuffer(8),
  };
}

function mock401Response() {
  return {
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    headers: { get: () => null },
  };
}

function mock500Response() {
  return {
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    headers: { get: () => null },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("installThemeFromRegistry — auth header", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
    mockAdmZipEntries = [];
    lastSavedTheme = null;
    mockSaveResult = null;
  });

  it("includes Authorization header when token is available", async () => {
    mockStoredToken = { token: "my-secret-token" };
    // Response will fail at ZIP parsing, but we only care about the fetch call
    mockFetchResponse = mockOkResponse();

    try {
      await controller.installThemeFromRegistry(null, "app1", "test-theme");
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
      await controller.installThemeFromRegistry(null, "app1", "test-theme");
    } catch {
      // ZIP parsing failure expected
    }

    assert.ok(lastFetchUrl, "fetch URL should be set");
    assert.ok(
      lastFetchUrl.includes("/api/packages/"),
      "URL should include /api/packages/ path",
    );
    assert.ok(
      lastFetchUrl.includes("ocean-depth"),
      "URL should include package name from registry lookup",
    );
    assert.ok(
      lastFetchUrl.includes("version=1.2.0"),
      "URL should include version from package",
    );
  });

  it("does not include Authorization header when token object has no token field", async () => {
    mockStoredToken = {}; // truthy object, but no .token
    mockFetchResponse = mockOkResponse();

    try {
      await controller.installThemeFromRegistry(null, "app1", "test-theme");
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

describe("installThemeFromRegistry — missing token", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
    mockAdmZipEntries = [];
    lastSavedTheme = null;
    mockSaveResult = null;
  });

  it("returns authRequired when no token is stored", async () => {
    mockStoredToken = null;

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "test-theme",
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

    await controller.installThemeFromRegistry(null, "app1", "test-theme");

    assert.equal(
      lastFetchUrl,
      null,
      "fetch should not be called when token is missing",
    );
  });
});

describe("installThemeFromRegistry — 401 handling", () => {
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

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "test-theme",
    );

    assert.equal(result.success, false);
    assert.equal(result.authRequired, true);
  });

  it("clears token on 401 response", async () => {
    mockFetchResponse = mock401Response();

    await controller.installThemeFromRegistry(null, "app1", "test-theme");

    assert.equal(clearTokenCalled, true, "clearToken should be called on 401");
  });

  it("returns appropriate error message on 401", async () => {
    mockFetchResponse = mock401Response();

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "test-theme",
    );

    assert.ok(
      result.error.toLowerCase().includes("expired") ||
        result.error.toLowerCase().includes("sign in"),
      "Error message should mention expired auth or sign in",
    );
  });

  it("does not clear token on non-401 errors", async () => {
    mockFetchResponse = mock500Response();

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "test-theme",
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

describe("installThemeFromRegistry — retry flow contract", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
    mockAdmZipEntries = [];
    lastSavedTheme = null;
    mockSaveResult = null;
  });

  it("succeeds on retry when token becomes available", async () => {
    // First call: no token → authRequired
    mockStoredToken = null;
    const first = await controller.installThemeFromRegistry(
      null,
      "app1",
      "test-theme",
    );
    assert.equal(first.authRequired, true, "First call should require auth");

    // Simulate auth completion: token is now available
    mockStoredToken = { token: "fresh-token" };
    mockFetchResponse = mockOkResponse();

    // Second call (auto-retry) — will fail at ZIP parsing but proves
    // the function proceeds past the auth gate with the new token
    try {
      await controller.installThemeFromRegistry(null, "app1", "test-theme");
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

    const first = await controller.installThemeFromRegistry(
      null,
      "app1",
      "test-theme",
    );
    assert.equal(first.authRequired, true);
    assert.equal(clearTokenCalled, true, "Stale token should be cleared");

    // Simulate re-auth
    clearTokenCalled = false;
    mockStoredToken = { token: "new-token-after-reauth" };
    mockFetchResponse = mockOkResponse();

    try {
      await controller.installThemeFromRegistry(null, "app1", "test-theme");
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

// ---------------------------------------------------------------------------
// DASH-150: Pipeline failure scenarios (post-auth)
// ---------------------------------------------------------------------------
describe("installThemeFromRegistry — pipeline failure scenarios", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
    mockAdmZipEntries = [];
    lastSavedTheme = null;
    mockSaveResult = null;
  });

  it("returns error when package is not found in registry", async () => {
    mockStoredToken = { token: "valid-token" };
    mockGetPackageResult = null;

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "nonexistent-theme",
    );

    assert.equal(result.success, false);
    assert.ok(
      result.error.includes("not found"),
      "Error should indicate package not found",
    );
    assert.equal(lastFetchUrl, null, "fetch should not be called");
  });

  it("returns error when ZIP has no .theme.json file", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      { entryName: "manifest.json", getData: () => Buffer.from("{}") },
      { entryName: "readme.txt", getData: () => Buffer.from("hello") },
    ];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, false);
    assert.ok(
      result.error.includes(".theme.json"),
      "Error should mention missing .theme.json",
    );
  });

  it("returns error when theme JSON is invalid", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      { entryName: "manifest.json", getData: () => Buffer.from("{}") },
      {
        entryName: "ocean-depth.theme.json",
        getData: () => Buffer.from("not valid json{{{"),
      },
    ];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, false);
    assert.ok(
      result.error.toLowerCase().includes("invalid json"),
      "Error should indicate invalid JSON",
    );
  });

  it("returns error when themeController.saveThemeForApplication fails", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      createMockThemeEntry("ocean-depth.theme.json", MOCK_THEME_DATA),
    ];
    mockSaveResult = { error: true, message: "Disk write failed" };

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, false);
    assert.ok(
      result.error.includes("Disk write failed"),
      "Error should propagate save failure message",
    );
  });

  it("rejects ZIP entries with path traversal", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      {
        entryName: "../../etc/evil.theme.json",
        getData: () => Buffer.from(JSON.stringify(MOCK_THEME_DATA), "utf-8"),
      },
    ];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, false);
    assert.ok(
      result.error.toLowerCase().includes("invalid file path"),
      "Error should indicate invalid file path in ZIP",
    );
  });
});

// ---------------------------------------------------------------------------
// DASH-150: Happy path — authorized user → successful install (end-to-end)
// ---------------------------------------------------------------------------
describe("installThemeFromRegistry — happy path end-to-end", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
    mockAdmZipEntries = [];
    lastSavedTheme = null;
    mockSaveResult = null;
  });

  it("installs a theme successfully with realistic registry data", async () => {
    mockStoredToken = { token: "valid-registry-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      { entryName: "manifest.json", getData: () => Buffer.from("{}") },
      createMockThemeEntry("ocean-depth.theme.json", MOCK_THEME_DATA),
    ];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, true, "Install should succeed");
    assert.equal(
      result.themeKey,
      "Ocean Depth",
      "themeKey should use displayName from package",
    );
    assert.ok(result.theme, "Result should include theme data");
    assert.equal(
      result.theme.name,
      "Ocean Depth",
      "Theme data should preserve original name",
    );
    assert.ok(
      result.theme._registryMeta,
      "Theme should have registry metadata",
    );
    assert.equal(
      result.theme._registryMeta.source,
      "registry",
      "Registry meta source should be 'registry'",
    );
    assert.equal(
      result.theme._registryMeta.packageName,
      "ocean-depth",
      "Registry meta should track original package name",
    );
  });

  it("passes correct theme data to saveThemeForApplication", async () => {
    mockStoredToken = { token: "valid-registry-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      createMockThemeEntry("ocean-depth.theme.json", MOCK_THEME_DATA),
    ];

    await controller.installThemeFromRegistry(null, "app1", "ocean-depth");

    assert.ok(lastSavedTheme, "saveThemeForApplication should be called");
    assert.equal(
      lastSavedTheme.key,
      "Ocean Depth",
      "Theme key should be the displayName",
    );
    assert.equal(
      lastSavedTheme.data.primary,
      "blue",
      "Theme color families should be preserved",
    );
    assert.equal(
      lastSavedTheme.data.mode,
      "dark",
      "Theme mode should be preserved",
    );
  });

  it("constructs correct URL with scope and version from package", async () => {
    mockStoredToken = { token: "tok" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      createMockThemeEntry("ocean-depth.theme.json", MOCK_THEME_DATA),
    ];

    await controller.installThemeFromRegistry(null, "app1", "ocean-depth");

    assert.ok(lastFetchUrl, "fetch URL should be set");
    assert.ok(
      lastFetchUrl.includes(encodeURIComponent("@trops")),
      "URL should include encoded scope",
    );
    assert.ok(
      lastFetchUrl.includes("ocean-depth"),
      "URL should include package name",
    );
    assert.ok(
      lastFetchUrl.includes("version=1.2.0"),
      "URL should include version from package",
    );
  });

  it("uses package name as themeKey when displayName is absent", async () => {
    mockStoredToken = { token: "tok" };
    mockFetchResponse = mockOkResponse();
    mockGetPackageResult = {
      name: "minimal-theme",
      scope: "@user",
      version: "0.1.0",
    };
    mockAdmZipEntries = [
      createMockThemeEntry("minimal-theme.theme.json", {
        name: "Minimal",
        primary: "red",
      }),
    ];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "minimal-theme",
    );

    assert.equal(result.success, true);
    assert.equal(
      result.themeKey,
      "minimal-theme",
      "Should fall back to package name when displayName is absent",
    );
  });
});

// ---------------------------------------------------------------------------
// DASH-155: Identified failure scenario — scope/name mismatch & URL encoding
// ---------------------------------------------------------------------------
describe("installThemeFromRegistry — scope/name edge cases (DASH-155)", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
    mockAdmZipEntries = [];
    lastSavedTheme = null;
    mockSaveResult = null;
  });

  it("encodes scope with @ prefix correctly in download URL", async () => {
    mockStoredToken = { token: "tok" };
    mockFetchResponse = mockOkResponse();
    mockGetPackageResult = {
      ...MOCK_PKG,
      scope: "@my-org",
      name: "night-sky",
    };
    mockAdmZipEntries = [
      createMockThemeEntry("night-sky.theme.json", MOCK_THEME_DATA),
    ];

    await controller.installThemeFromRegistry(null, "app1", "night-sky");

    assert.ok(lastFetchUrl, "fetch URL should be set");
    assert.ok(
      lastFetchUrl.includes(encodeURIComponent("@my-org")),
      "URL should encode the @ in scope",
    );
    assert.ok(
      !lastFetchUrl.includes("/@my-org/"),
      "Scope should be encoded, not raw",
    );
  });

  it("handles package with empty scope", async () => {
    mockStoredToken = { token: "tok" };
    mockFetchResponse = mockOkResponse();
    mockGetPackageResult = {
      ...MOCK_PKG,
      scope: "",
      name: "unscoped-theme",
      displayName: "Unscoped Theme",
    };
    mockAdmZipEntries = [
      createMockThemeEntry("unscoped-theme.theme.json", MOCK_THEME_DATA),
    ];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "unscoped-theme",
    );

    assert.equal(result.success, true);
    assert.equal(result.themeKey, "Unscoped Theme");
    assert.ok(lastFetchUrl, "fetch URL should be set");
  });

  it("handles package name with special characters", async () => {
    mockStoredToken = { token: "tok" };
    mockFetchResponse = mockOkResponse();
    mockGetPackageResult = {
      ...MOCK_PKG,
      scope: "@trops",
      name: "my theme (v2)",
    };

    try {
      await controller.installThemeFromRegistry(null, "app1", "my theme (v2)");
    } catch {
      // May fail at ZIP parsing — we care about URL encoding
    }

    assert.ok(lastFetchUrl, "fetch URL should be set");
    assert.ok(
      lastFetchUrl.includes(encodeURIComponent("my theme (v2)")),
      "Package name with special characters should be URL-encoded",
    );
  });

  it("uses version from package metadata, not hardcoded default", async () => {
    mockStoredToken = { token: "tok" };
    mockFetchResponse = mockOkResponse();
    mockGetPackageResult = {
      ...MOCK_PKG,
      version: "3.5.1",
    };
    mockAdmZipEntries = [
      createMockThemeEntry("ocean-depth.theme.json", MOCK_THEME_DATA),
    ];

    await controller.installThemeFromRegistry(null, "app1", "ocean-depth");

    assert.ok(
      lastFetchUrl.includes("version=3.5.1"),
      "URL should use the version from the package, not a default",
    );
  });

  it("falls back to version 1.0.0 when package has no version", async () => {
    mockStoredToken = { token: "tok" };
    mockFetchResponse = mockOkResponse();
    mockGetPackageResult = {
      name: "no-version-theme",
      scope: "@trops",
      displayName: "No Version",
    };
    mockAdmZipEntries = [
      createMockThemeEntry("no-version-theme.theme.json", MOCK_THEME_DATA),
    ];

    await controller.installThemeFromRegistry(null, "app1", "no-version-theme");

    assert.ok(
      lastFetchUrl.includes("version=1.0.0"),
      "URL should fall back to version 1.0.0 when package has no version field",
    );
  });
});

// ---------------------------------------------------------------------------
// DASH-155: Additional HTTP error and exception scenarios
// ---------------------------------------------------------------------------
describe("installThemeFromRegistry — HTTP and exception scenarios (DASH-155)", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
    mockAdmZipEntries = [];
    lastSavedTheme = null;
    mockSaveResult = null;
  });

  it("returns error with status code on 403 response", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: { get: () => null },
    };

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, false);
    assert.ok(
      result.error.includes("403"),
      "Error should include the HTTP status code",
    );
    assert.equal(
      result.authRequired,
      undefined,
      "403 should NOT set authRequired (only 401 does)",
    );
    assert.equal(clearTokenCalled, false, "Token should NOT be cleared on 403");
  });

  it("returns error with status code on 404 response", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
    };

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, false);
    assert.ok(
      result.error.includes("404"),
      "Error should include the HTTP status code",
    );
  });

  it("returns error when ZIP has zero entries", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, false);
    assert.ok(
      result.error.includes(".theme.json"),
      "Error should mention missing .theme.json when ZIP is empty",
    );
  });
});

// ---------------------------------------------------------------------------
// DASH-155: Happy path — registry metadata and save verification
// ---------------------------------------------------------------------------
describe("installThemeFromRegistry — registry metadata verification (DASH-155)", () => {
  beforeEach(() => {
    mockStoredToken = null;
    clearTokenCalled = false;
    lastFetchUrl = null;
    lastFetchOptions = null;
    mockFetchResponse = null;
    mockGetPackageResult = MOCK_PKG;
    mockAdmZipEntries = [];
    lastSavedTheme = null;
    mockSaveResult = null;
  });

  it("attaches _registryMeta with installedAt timestamp", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      createMockThemeEntry("ocean-depth.theme.json", MOCK_THEME_DATA),
    ];

    const before = new Date().toISOString();
    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );
    const after = new Date().toISOString();

    assert.equal(result.success, true);
    assert.ok(
      result.theme._registryMeta.installedAt,
      "Should have installedAt",
    );
    assert.ok(
      result.theme._registryMeta.installedAt >= before &&
        result.theme._registryMeta.installedAt <= after,
      "installedAt should be a recent ISO timestamp",
    );
  });

  it("preserves all original theme fields alongside _registryMeta", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    const originalTheme = {
      name: "Custom Theme",
      primary: "indigo",
      secondary: "slate",
      tertiary: "zinc",
      neutral: "gray",
      mode: "light",
      fontFamily: "Fira Code, monospace",
      customField: "should-be-preserved",
    };
    mockAdmZipEntries = [
      createMockThemeEntry("ocean-depth.theme.json", originalTheme),
    ];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, true);
    assert.equal(result.theme.name, "Custom Theme");
    assert.equal(result.theme.primary, "indigo");
    assert.equal(result.theme.mode, "light");
    assert.equal(result.theme.fontFamily, "Fira Code, monospace");
    assert.equal(result.theme.customField, "should-be-preserved");
    assert.ok(result.theme._registryMeta, "Should have _registryMeta");
  });

  it("returns themes map from saveThemeForApplication", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    mockAdmZipEntries = [
      createMockThemeEntry("ocean-depth.theme.json", MOCK_THEME_DATA),
    ];
    mockSaveResult = {
      themes: {
        "Ocean Depth": MOCK_THEME_DATA,
        "Existing Theme": { name: "Existing" },
      },
    };

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, true);
    assert.ok(result.themes, "Result should include themes map");
    assert.ok(
      result.themes["Ocean Depth"],
      "Themes map should include installed theme",
    );
    assert.ok(
      result.themes["Existing Theme"],
      "Themes map should include pre-existing themes",
    );
  });

  it("picks the first .theme.json when ZIP has multiple", async () => {
    mockStoredToken = { token: "valid-token" };
    mockFetchResponse = mockOkResponse();
    const secondTheme = { ...MOCK_THEME_DATA, name: "Second Theme" };
    mockAdmZipEntries = [
      { entryName: "manifest.json", getData: () => Buffer.from("{}") },
      createMockThemeEntry("first.theme.json", MOCK_THEME_DATA),
      createMockThemeEntry("second.theme.json", secondTheme),
    ];

    const result = await controller.installThemeFromRegistry(
      null,
      "app1",
      "ocean-depth",
    );

    assert.equal(result.success, true);
    assert.equal(
      result.theme.name,
      "Ocean Depth",
      "Should use the first .theme.json entry found",
    );
  });
});

/**
 * useMcpProvider — call-tool timeout alignment.
 *
 * The renderer's `callTool` Promise has its own timeout. If that timeout
 * is shorter than the main-side JIT-consent timeout, the Promise rejects
 * mid-prompt — even when the user eventually approves, the widget has
 * already errored out. This test pins the constant so a future shave
 * doesn't reintroduce the bug.
 *
 * Static source-presence test (matches providerHookIdentityFallback
 * style) — avoids dragging React into Jest just to read a number.
 */
const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "useMcpProvider.js"),
  "utf8",
);

// Read from `electron/mcp/jitConsent.js`'s source (a renderer test can't
// require the electron-only module), so the two can't drift apart.
// Accepts a literal like `300_000` or a product like `5 * 60 * 1000`.
const MAIN_JIT_TIMEOUT_MS = (() => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "electron", "mcp", "jitConsent.js"),
    "utf8",
  );
  const m = src.match(/const DEFAULT_TIMEOUT_MS = ([\d_*\s]+);/);
  if (!m) throw new Error("DEFAULT_TIMEOUT_MS not found in jitConsent.js");
  return m[1]
    .split("*")
    .map((n) => Number(n.trim().replace(/_/g, "")))
    .reduce((a, b) => a * b, 1);
})();
const REQUIRED_SLACK_MS = 25_000; // IPC + grant write + re-eval headroom

describe("useMcpProvider — CALL_TOOL_TIMEOUT_MS", () => {
  test("is exported as a named module-level constant", () => {
    // Extracting to a constant (vs an inline literal) makes the value
    // visible to this test and signals to future readers that the
    // figure is load-bearing, not arbitrary.
    expect(SOURCE).toMatch(/export\s+const\s+CALL_TOOL_TIMEOUT_MS\s*=\s*\d/);
  });

  test("exceeds main-side JIT timeout by at least the required slack", () => {
    const match = SOURCE.match(
      /export\s+const\s+CALL_TOOL_TIMEOUT_MS\s*=\s*([\d_]+)/,
    );
    expect(match).not.toBeNull();
    const value = Number(match[1].replace(/_/g, ""));
    expect(value).toBeGreaterThanOrEqual(
      MAIN_JIT_TIMEOUT_MS + REQUIRED_SLACK_MS,
    );
  });

  test("setTimeout in callTool uses the constant, not an inline literal", () => {
    // Regression guard: if a future refactor reintroduces an inline
    // number, the test catches it — otherwise the constant could grow
    // while the actual setTimeout stays at 30000. Anchored on the
    // closing `},` of the arrow body since the arg list contains
    // commas inside the inner template literal.
    expect(SOURCE).toMatch(/}\s*,\s*CALL_TOOL_TIMEOUT_MS\s*\)/);
  });
});

describe("useMcpProvider — a server stopped under a call", () => {
  const { isServerGone } = require("./useMcpProvider");
  test("is recognised, so the call starts it again and retries once", () => {
    expect(
      isServerGone("Server not connected: __no_workspace__::Google Calendar"),
    ).toBe(true);
    expect(isServerGone("Not connected")).toBe(true);
    expect(isServerGone("API error: 400 - Bad Request")).toBe(false);
    expect(isServerGone('Tool "x" is not allowed for this widget')).toBe(false);
  });
  test("callTool retries through connect() once — never in a loop", () => {
    const body = SOURCE.slice(SOURCE.indexOf("const callTool = useCallback"));
    expect(body).toMatch(
      /if \(!isServerGone\(e && e\.message\)\) throw e;[\s\S]{0,200}await connect\(\);\s*return call\(\);/,
    );
  });
});

describe("useMcpProvider — the app's own read (internal)", () => {
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "useMcpProvider.js"),
    "utf8",
  );
  test("no widget permission to ask, no Issue, no widget events", () => {
    expect(src).toMatch(/const widgetIdForGate = internal \? null :/);
    expect(src).toMatch(/if \(internal\) return;/);
    expect(src).toMatch(
      /internal \? \{\} : widgetFacts\(widgetData, workspace\)/,
    );
    expect(src).toMatch(/if \(!selectedProviderName \|\| internal\) return;/);
  });
  test("left while its server started: the hold is let go", () => {
    expect(src).toMatch(
      /if \(!mountedRef\.current\) \{[\s\S]{0,200}releaseServer\(dashApi, selectedProviderName, workspaceId, stateKey\)/,
    );
  });
});

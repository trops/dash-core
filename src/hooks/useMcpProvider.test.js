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

// Mirrors `electron/mcp/jitConsent.js` (DEFAULT_TIMEOUT_MS = 60_000).
// Pinning here avoids a cross-package import from the renderer test
// into the electron-only module.
const MAIN_JIT_TIMEOUT_MS = 60_000;
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

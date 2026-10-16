import { cleanIpcError } from "./errorUtils";

describe("cleanIpcError", () => {
  test("strips Electron's IPC prefix", () => {
    expect(
      cleanIpcError(
        "Error invoking remote method 'widget:install': Error: Failed to fetch: Unauthorized",
      ),
    ).toBe("Failed to fetch: Unauthorized");
  });

  // The install gate's refusal lists each problem on its own line
  // (consolidation Phase 1a) — none of them may be dropped.
  test("keeps every line of a multi-line reason", () => {
    expect(
      cleanIpcError(
        "Error invoking remote method 'widget:install': Error: @x/y wasn't installed — it didn't pass its checks:\n- Hello: one\n- Hello: two",
      ),
    ).toBe(
      "@x/y wasn't installed — it didn't pass its checks:\n- Hello: one\n- Hello: two",
    );
  });

  test("leaves other messages alone", () => {
    expect(cleanIpcError("Plain")).toBe("Plain");
    expect(cleanIpcError(undefined)).toBe(undefined);
  });
});

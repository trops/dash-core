/**
 * groupRowsByPackage.test.js
 *
 * Pin for the renderer-side helper that groups Privacy & Security
 * rows (one per widget, returned by `widgetMcp.listAll`) by their
 * owning package — drives the new package-list UX.
 *
 * Pure function. Source-of-truth for parsing dotted ids back to
 * scoped package ids matches resolveSiblings.js semantics in the
 * main process.
 *
 * Runs via Jest (matches makeBoundApi.test.js style).
 */
import { groupRowsByPackage } from "./groupRowsByPackage";

const makeRow = (widgetId, granted = null) => ({
  widgetId,
  declared: null,
  granted,
  hasManifest: !!granted,
  grantOrigin: granted ? "live" : null,
});

describe("groupRowsByPackage", () => {
  test("groups rows sharing the same dotted scope+name prefix", () => {
    const groups = groupRowsByPackage([
      makeRow("trops.google-drive.GDriveFileList"),
      makeRow("trops.google-drive.GDriveFilePreview"),
      makeRow("trops.chat.ChatAnthropicWidget"),
    ]);
    expect(groups.length).toBe(2);
    const gdrive = groups.find((g) => g.packageId === "@trops/google-drive");
    expect(gdrive).toBeDefined();
    expect(gdrive.widgets.length).toBe(2);
    const chat = groups.find((g) => g.packageId === "@trops/chat");
    expect(chat.widgets.length).toBe(1);
  });

  test("packages are sorted alphabetically by displayName", () => {
    const groups = groupRowsByPackage([
      makeRow("trops.zeta.W"),
      makeRow("trops.alpha.W"),
      makeRow("ai-built.middle.W"),
    ]);
    expect(groups.map((g) => g.packageId)).toEqual([
      "@ai-built/middle",
      "@trops/alpha",
      "@trops/zeta",
    ]);
  });

  test("computes grantCount and hasAnyGrant from rows with non-empty granted", () => {
    const groups = groupRowsByPackage([
      makeRow("trops.pkg.A", { servers: { x: { tools: ["t"] } } }),
      makeRow("trops.pkg.B"),
      makeRow("trops.pkg.C", {
        domains: { fs: { writePaths: ["/tmp"] } },
      }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].grantCount).toBe(2);
    expect(groups[0].hasAnyGrant).toBe(true);
  });

  test("hasAnyGrant is false when every row has null/empty granted", () => {
    const groups = groupRowsByPackage([
      makeRow("trops.pkg.A"),
      makeRow("trops.pkg.B"),
    ]);
    expect(groups[0].grantCount).toBe(0);
    expect(groups[0].hasAnyGrant).toBe(false);
  });

  test("unparseable widgetIds get bucketed under a synthetic ungrouped entry", () => {
    const groups = groupRowsByPackage([
      makeRow("@test/jit-probe", {
        servers: { "test-server": { tools: ["test_tool"] } },
      }),
      makeRow("trops.real.WidgetA"),
    ]);
    expect(groups.length).toBe(2);
    const ungrouped = groups.find((g) => g.packageId === null);
    expect(ungrouped).toBeDefined();
    expect(ungrouped.widgets.length).toBe(1);
    expect(ungrouped.widgets[0].widgetId).toBe("@test/jit-probe");
    expect(ungrouped.grantCount).toBe(1);
  });

  test("preserves widget order within each package as supplied", () => {
    const groups = groupRowsByPackage([
      makeRow("trops.pkg.Charlie"),
      makeRow("trops.pkg.Alpha"),
      makeRow("trops.pkg.Bravo"),
    ]);
    expect(groups[0].widgets.map((w) => w.widgetId)).toEqual([
      "trops.pkg.Charlie",
      "trops.pkg.Alpha",
      "trops.pkg.Bravo",
    ]);
  });

  test("each group exposes a displayName usable in the sidebar", () => {
    const groups = groupRowsByPackage([
      makeRow("trops.google-drive.GDriveFileList"),
    ]);
    expect(groups[0].displayName).toBe("@trops/google-drive");
  });

  test("empty input returns empty array", () => {
    expect(groupRowsByPackage([])).toEqual([]);
  });

  test("non-array input returns empty array (defensive)", () => {
    expect(groupRowsByPackage(null)).toEqual([]);
    expect(groupRowsByPackage(undefined)).toEqual([]);
  });
});

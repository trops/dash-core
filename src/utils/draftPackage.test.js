/**
 * draftPackage — is this package a Widget Builder draft? Drafts are kept
 * out of the widget sidebar and pickers; Manage › Widgets lists them.
 */
import fs from "fs";
import path from "path";
import { isDraftPackage, draftIdOf } from "./draftPackage";

describe("isDraftPackage", () => {
  test("today's id-keyed drafts: @ai-built/draft-<id>", () => {
    expect(isDraftPackage("@ai-built/draft-1782438308083-2ohecu")).toBe(true);
    expect(isDraftPackage("ai-built/draft-1782438308083-2ohecu")).toBe(true);
  });

  test("older drafts: <name>-draft-<shortId>", () => {
    expect(isDraftPackage("@ai-built/inbox-draft-abc123")).toBe(true);
  });

  test("real packages aren't drafts", () => {
    expect(isDraftPackage("@ai-built/composedwidget3")).toBe(false);
    expect(isDraftPackage("@ai-built/draftboard")).toBe(false);
    expect(isDraftPackage("@trops/algolia")).toBe(false);
    expect(isDraftPackage("")).toBe(false);
    expect(isDraftPackage(null)).toBe(false);
  });

  test("draftIdOf gives the draft's id for today's drafts", () => {
    expect(draftIdOf("@ai-built/draft-1782438308083-2ohecu")).toBe(
      "draft-1782438308083-2ohecu",
    );
    expect(draftIdOf("@ai-built/inbox-draft-abc123")).toBe(null);
  });
});

describe("drafts stay out of the places you add widgets from", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  test.each([
    "Components/Navigation/WidgetSidebar.js",
    "Components/Layout/Builder/Enhanced/WidgetDropdown.js",
    "Components/Layout/Builder/Enhanced/EnhancedWidgetDropdown.js",
  ])("%s filters with isDraftPackage", (file) => {
    const src = read(file);
    expect(src).toMatch(
      /import \{ isDraftPackage \} from "[./]+utils\/draftPackage"/,
    );
    expect(src).toMatch(/isDraftPackage\([^)]*_sourcePackage/);
    expect(src).not.toMatch(/\/-draft-\[A-Za-z0-9\]\+\$\//);
  });

  test("useInstalledWidgets classifies today's drafts too", () => {
    const src = read("hooks/useInstalledWidgets.js");
    expect(src).toMatch(/isDraftPackage\(name\)/);
  });
});

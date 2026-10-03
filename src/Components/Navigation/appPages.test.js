import {
  APP_PAGES,
  getAppPage,
  isPageTabId,
  makePageTab,
  pageForSettingsSection,
  pageKeyOf,
  pageTabId,
} from "./appPages";

describe("appPages (app-navigation NAV-001/002)", () => {
  it("lists the five Manage pages in sidebar order", () => {
    expect(APP_PAGES.map((p) => p.key)).toEqual([
      "dashboards",
      "bots",
      "providers",
      "widgets",
      "themes",
    ]);
    for (const p of APP_PAGES) {
      expect(p.label).toBeTruthy();
      expect(p.icon).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it("page tab ids are page:<key> and round-trip", () => {
    expect(pageTabId("bots")).toBe("page:bots");
    expect(isPageTabId("page:bots")).toBe(true);
    expect(isPageTabId(12)).toBe(false);
    expect(isPageTabId("12")).toBe(false);
    expect(pageKeyOf("page:themes")).toBe("themes");
    expect(pageKeyOf(7)).toBeNull();
  });

  it("makes a page tab (no workspace) for known pages only", () => {
    expect(makePageTab("providers")).toEqual({
      id: "page:providers",
      kind: "page",
      pageKey: "providers",
      name: "Providers",
    });
    expect(makePageTab("nope")).toBeNull();
    expect(getAppPage("nope")).toBeNull();
  });

  it("maps the Settings sections that moved to their page", () => {
    expect(pageForSettingsSection("bots").key).toBe("bots");
    expect(pageForSettingsSection("providers").key).toBe("providers");
    expect(pageForSettingsSection("widgets").key).toBe("widgets");
    expect(pageForSettingsSection("themes").key).toBe("themes");
    expect(pageForSettingsSection("dashboards").key).toBe("dashboards");
    expect(pageForSettingsSection("folders").key).toBe("dashboards");
    expect(pageForSettingsSection("general")).toBeNull();
    expect(pageForSettingsSection("privacy-security")).toBeNull();
  });
});

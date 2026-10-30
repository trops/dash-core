/**
 * Whose a saved theme is (lead-workspace theme change round).
 */
import {
  isOwnPackage,
  hasEditorChanges,
  remixName,
  themeByName,
  themeColors,
  themeOrigin,
  themePublished,
} from "./themeStanding";

const installed = {
  name: "Dusk",
  author: "Alex R",
  registryRef: {
    package: "@alexr/dusk",
    kind: "theme",
    version: "1.2.0",
    origin: "installed",
  },
  _registryMeta: { source: "registry", packageName: "dusk" },
};
const published = {
  name: "Dusk",
  registryRef: {
    package: "@me/dusk",
    kind: "theme",
    version: "1.2.0",
    origin: "published",
  },
  _registryMeta: { packageName: "me/dusk", lastPublishedVersion: "1.2.0" },
};

describe("themeOrigin", () => {
  test("downloaded: its package, version and author", () => {
    expect(themeOrigin(installed)).toEqual({
      package: "@alexr/dusk",
      version: "1.2.0",
      author: "Alex R",
    });
    expect(themeOrigin({ ...installed, author: "" }).author).toBe("@alexr");
  });
  test("an older install with only its registry meta", () => {
    expect(
      themeOrigin({
        name: "Dusk",
        version: "1.0.0",
        _registryMeta: { packageName: "dusk", scope: "alexr" },
      }),
    ).toEqual({ package: "@alexr/dusk", version: "1.0.0", author: "@alexr" });
  });
  test("yours: made here, a copy, or published from here", () => {
    expect(themeOrigin({ name: "Mine", primary: "blue" })).toBeNull();
    expect(themeOrigin(published)).toBeNull();
    expect(
      themeOrigin({ name: "Copy", remixedFrom: { package: "@alexr/dusk" } }),
    ).toBeNull();
  });
});

describe("your own registry scope (theme change leftovers)", () => {
  const own = {
    name: "Dusk",
    registryRef: {
      package: "@me/dusk",
      kind: "theme",
      version: "1.2.0",
      origin: "installed",
    },
  };
  test("isOwnPackage: the signed-in user's scope, any case", () => {
    expect(isOwnPackage("@Me/dusk", "me")).toBe(true);
    expect(isOwnPackage("@me/dusk", "@ME")).toBe(true);
    expect(isOwnPackage("@alexr/dusk", "me")).toBe(false);
    expect(isOwnPackage("@me/dusk", null)).toBe(false);
  });
  test("installed from your own scope: yours, and published", () => {
    expect(themeOrigin(own, { username: "me" })).toBeNull();
    expect(themePublished(own, { username: "me" })).toEqual({
      package: "@me/dusk",
      version: "1.2.0",
    });
  });
  test("signed out: still treated as downloaded", () => {
    expect(themeOrigin(own).package).toBe("@me/dusk");
    expect(themePublished(own)).toBeNull();
  });
});

describe("themePublished", () => {
  test("published from here: package and version", () => {
    expect(themePublished(published)).toEqual({
      package: "@me/dusk",
      version: "1.2.0",
    });
  });
  test("never published, or downloaded: null", () => {
    expect(themePublished({ name: "Mine" })).toBeNull();
    expect(themePublished(installed)).toBeNull();
  });
});

test("themeColors: Tailwind names become hex", () => {
  const c = themeColors({ primary: "#C2562B", secondary: "blue" });
  expect(c.primary).toBe("#c2562b");
  expect(c.secondary).toMatch(/^#[0-9a-f]{6}$/);
  expect(c.tertiary).toBeUndefined();
});

test("hasEditorChanges", () => {
  expect(hasEditorChanges({ dark: {}, light: {} })).toBe(false);
  expect(hasEditorChanges({ dark: { "font-body": "Inter" } })).toBe(true);
});

test("remixName: the next free one", () => {
  expect(remixName("Dusk", ["Dawn"])).toBe("Dusk (remix)");
  expect(remixName("Dusk", ["dusk (remix)"])).toBe("Dusk (remix 2)");
});

test("themeByName: one theme by its name, any case", () => {
  const themes = { a: { name: "Dusk" }, b: { name: "Dawn" } };
  expect(themeByName(themes, " dusk ")[0]).toBe("a");
  expect(themeByName(themes, "Noon")).toBeNull();
  expect(themeByName({ ...themes, c: { name: "dusk" } }, "Dusk")).toBeNull();
});

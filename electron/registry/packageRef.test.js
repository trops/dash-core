/**
 * packageRef.test.js — one name for a registry package, and reading which
 * package a dashboard, theme, bot, team or widget came from, from the new
 * `registryRef` or the older fields each kind kept.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePackageRef,
  makeRegistryRef,
  readRegistryRef,
  samePackage,
  withoutRegistryRef,
  keepRegistryRef,
} = require("./packageRef");
const {
  stripPersonalizationFromWorkspace,
} = require("../schema/dashboardConfigUtils");

describe("normalizePackageRef", () => {
  it("reads @scope/name, scope/name and {scope, name}", () => {
    for (const input of [
      "@trops/kitchen",
      "trops/kitchen",
      { scope: "@trops", name: "kitchen" },
      { name: "trops/kitchen" },
    ]) {
      assert.deepEqual(normalizePackageRef(input), {
        scope: "trops",
        name: "kitchen",
        id: "@trops/kitchen",
      });
    }
  });

  it("refuses a bare name (its scope is unknown) and malformed input", () => {
    for (const input of [
      "kitchen",
      "",
      null,
      42,
      "@trops/",
      "a/b/c",
      "@../x",
      { scope: "trops" },
      "trops/kit chen",
    ]) {
      assert.equal(normalizePackageRef(input), null, String(input));
    }
  });
});

describe("makeRegistryRef", () => {
  it("records the package, kind, version and origin", () => {
    const ref = makeRegistryRef({
      package: "trops/kitchen",
      kind: "dashboard",
      version: "1.2.0",
      origin: "installed",
      at: "2026-10-27T00:00:00.000Z",
    });
    assert.deepEqual(ref, {
      package: "@trops/kitchen",
      kind: "dashboard",
      version: "1.2.0",
      origin: "installed",
      at: "2026-10-27T00:00:00.000Z",
    });
  });

  it("is null for an unknown package, kind or origin", () => {
    const base = { package: "@trops/k", kind: "theme", origin: "published" };
    assert.equal(makeRegistryRef({ ...base, package: "k" }), null);
    assert.equal(makeRegistryRef({ ...base, kind: "app" }), null);
    assert.equal(makeRegistryRef({ ...base, origin: "copied" }), null);
    assert.ok(makeRegistryRef(base));
  });
});

describe("readRegistryRef", () => {
  const ref = (kind, origin, version = "2.0.0") =>
    makeRegistryRef({ package: "@trops/kitchen", kind, version, origin });

  it("prefers registryRef when it's for this kind", () => {
    const ws = {
      registryRef: ref("dashboard", "published"),
      _dashboardConfig: { registryPackage: "old", installedVersion: "1.0.0" },
    };
    const r = readRegistryRef("dashboard", ws);
    assert.equal(r.package, "@trops/kitchen");
    assert.equal(r.version, "2.0.0");
    assert.equal(r.origin, "published");
    // A ref for another kind is ignored.
    assert.equal(
      readRegistryRef("dashboard", { registryRef: ref("theme", "installed") }),
      null,
    );
  });

  it("dashboards: a publish (scope + version) or an install (often a bare name)", () => {
    const published = readRegistryRef("dashboard", {
      _dashboardConfig: {
        registryPackage: "kitchen",
        registryScope: "trops",
        version: "1.3.0",
        installedVersion: "1.0.0",
      },
    });
    assert.equal(published.package, "@trops/kitchen");
    assert.equal(published.version, "1.3.0");
    assert.equal(published.origin, "published");

    const bare = readRegistryRef("dashboard", {
      _dashboardConfig: {
        registryPackage: "Kitchen",
        installedVersion: "1.0.0",
      },
    });
    assert.equal(bare.package, null);
    assert.equal(bare.name, "kitchen");
    assert.equal(bare.origin, "installed");

    const scoped = readRegistryRef("dashboard", {
      _dashboardConfig: { registryPackage: "trops/kitchen-sink" },
    });
    assert.equal(scoped.package, "@trops/kitchen-sink");
    assert.equal(scoped.version, null);

    assert.equal(readRegistryRef("dashboard", { name: "Mine" }), null);
  });

  it("themes: lastPublishedVersion, else the theme's version", () => {
    const pub = readRegistryRef("theme", {
      version: "1.0.0",
      _registryMeta: {
        packageName: "trops/ocean",
        lastPublishedVersion: "1.1.0",
      },
    });
    assert.equal(pub.package, "@trops/ocean");
    assert.equal(pub.version, "1.1.0");
    assert.equal(pub.origin, "published");
    const inst = readRegistryRef("theme", {
      version: "0.9.0",
      _registryMeta: { source: "registry", packageName: "trops/ocean" },
    });
    assert.equal(inst.version, "0.9.0");
    assert.equal(inst.origin, "installed");
  });

  it("bots and teams: published, else installedFrom", () => {
    const pub = readRegistryRef("bot", {
      published: { name: "trops/brief", version: "1.0.2" },
      installedFrom: { package: "trops/brief", version: "1.0.0" },
    });
    assert.equal(pub.version, "1.0.2");
    assert.equal(pub.origin, "published");
    const team = readRegistryRef("bot-team", {
      installedFrom: {
        package: "someone/crew",
        version: "3.0.0",
        role: "lead",
      },
    });
    assert.equal(team.package, "@someone/crew");
    assert.equal(team.origin, "installed");
  });

  it("widgets: a registry install, or a local build", () => {
    const reg = readRegistryRef("widget", {
      packageId: "@trops/chat",
      version: "0.0.882",
      installSource: "registry",
    });
    assert.equal(reg.package, "@trops/chat");
    assert.equal(reg.origin, "installed");
    const local = readRegistryRef("widget", {
      scope: "ai-built",
      name: "pipeline",
      version: "1.0.0",
      installSource: "local",
    });
    assert.equal(local.package, "@ai-built/pipeline");
    assert.equal(local.origin, "local");
  });
});

describe("samePackage", () => {
  const read = (pkg) =>
    readRegistryRef("bot", {
      installedFrom: { package: pkg, version: "1.0.0" },
    });

  it("compares scopes when both have one", () => {
    assert.equal(samePackage(read("trops/brief"), read("@Trops/brief")), true);
    assert.equal(
      samePackage(read("trops/brief"), read("someone/brief")),
      false,
    );
  });

  it("falls back to the bare name when one copy kept only that", () => {
    assert.equal(samePackage(read("brief"), read("someone/brief")), true);
    assert.equal(samePackage(read("brief"), null), false);
  });
});

describe("publishing a dashboard", () => {
  it("leaves out the publisher's registryRef", () => {
    const ws = {
      id: 1,
      layout: [],
      registryRef: makeRegistryRef({
        package: "@trops/kitchen",
        kind: "dashboard",
        version: "1.0.0",
        origin: "published",
      }),
    };
    const cleaned = stripPersonalizationFromWorkspace(ws);
    assert.equal("registryRef" in cleaned, false);
    assert.ok(ws.registryRef, "the input isn't changed");
  });

  it("a bundled theme goes without its registryRef", () => {
    const theme = { name: "Ocean", registryRef: { package: "@trops/ocean" } };
    assert.deepEqual(withoutRegistryRef(theme), { name: "Ocean" });
    assert.ok(theme.registryRef, "the input isn't changed");
    assert.equal(withoutRegistryRef(null), null);
  });
});

describe("keepRegistryRef (saving an edited dashboard)", () => {
  const stored = {
    id: 1,
    registryRef: { package: "@trops/ha", kind: "dashboard", version: "1.0.0" },
  };

  it("keeps the stored ref when the editor's save doesn't carry one", () => {
    const saved = keepRegistryRef({ id: 1, name: "HA" }, stored);
    assert.deepEqual(saved.registryRef, stored.registryRef);
    assert.equal(saved.name, "HA");
  });

  it("a save that carries one (or clears it explicitly) wins", () => {
    const next = { package: "@trops/ha", kind: "dashboard", version: "1.1.0" };
    assert.equal(
      keepRegistryRef({ id: 1, registryRef: next }, stored).registryRef,
      next,
    );
    assert.equal(
      keepRegistryRef({ id: 1, registryRef: undefined }, stored).registryRef,
      undefined,
    );
  });

  it("nothing stored → the save as it is", () => {
    const incoming = { id: 2 };
    assert.equal(keepRegistryRef(incoming, null), incoming);
    assert.equal(keepRegistryRef(incoming, { id: 2 }), incoming);
  });
});

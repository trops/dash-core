/**
 * publishHeadless.test.js — dash-profiles v2 groundwork C: publishing a
 * dashboard or theme without asking. The name is picked automatically (the
 * item's own package, or a free one with "-2", "-3"…), the version is the
 * next one the registry doesn't have, a new package is private and an
 * existing one keeps its visibility; `@ai-built` widgets go out under the
 * publisher's name while anyone else's keep their author's.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { planPackagePublish, getPackageInfo } = require("./registryPackages");
const {
  publishScopeOf,
  localScopesOf,
  slugifyPackageName,
  suffixedPackageName,
  generateRegistryManifest,
  remapLayoutPackageScopes,
  assertNoLocalScopes,
} = require("../schema/dashboardConfigUtils");

// A fake registry: "@scope/name" → info (or "unreachable").
const registry = (entries) => async (pkg) =>
  Object.prototype.hasOwnProperty.call(entries, pkg) ? entries[pkg] : null;

describe("planPackagePublish", () => {
  const dashboard = (extra = {}) => ({
    kind: "dashboard",
    displayName: "Home Lab",
    username: "trops",
    record: { id: 1, name: "Home Lab" },
    ...extra,
  });

  it("a first publish: a slug of the name, private, 1.0.0", async () => {
    const plan = await planPackagePublish(dashboard(), registry({}));
    assert.deepEqual(plan, {
      package: "@trops/home-lab",
      name: "home-lab",
      version: "1.0.0",
      exists: false,
      visibility: "private",
      renamed: false,
    });
  });

  it("a name another item already has gets -2, -3 — never on top of it", async () => {
    const plan = await planPackagePublish(
      dashboard(),
      registry({
        "@trops/home-lab": { type: "dashboard", versions: ["1.0.0"] },
        "@trops/home-lab-2": { type: "widget", versions: ["0.1.0"] },
      }),
    );
    assert.equal(plan.package, "@trops/home-lab-3");
    assert.equal(plan.renamed, true);
    assert.equal(plan.visibility, "private");
  });

  it("an item published before keeps its package: the next free version, visibility kept", async () => {
    const record = {
      id: 1,
      name: "Renamed Since",
      registryRef: {
        package: "@trops/home-lab",
        kind: "dashboard",
        version: "1.0.2",
        origin: "published",
      },
    };
    const plan = await planPackagePublish(
      dashboard({ record, displayName: "Renamed Since" }),
      registry({
        "@trops/home-lab": {
          type: "dashboard",
          versions: ["1.0.2", "1.0.3"],
          visibility: "public",
        },
      }),
    );
    assert.equal(plan.package, "@trops/home-lab");
    assert.equal(plan.version, "1.0.4");
    assert.equal(plan.exists, true);
    assert.equal(
      "visibility" in plan,
      false,
      "none sent: the registry keeps it",
    );
    assert.equal(plan.renamed, false);
  });

  it("the older publish record (_dashboardConfig) binds it too", async () => {
    const record = {
      _dashboardConfig: {
        registryPackage: "home-lab",
        registryScope: "trops",
        version: "2.0.0",
      },
    };
    const plan = await planPackagePublish(
      dashboard({ record }),
      registry({
        "@trops/home-lab": { type: "dashboard", versions: ["2.0.0"] },
      }),
    );
    assert.equal(plan.package, "@trops/home-lab");
    assert.equal(plan.version, "2.0.1");
  });

  it("deleted from the registry since: published again under its name", async () => {
    const record = {
      registryRef: {
        package: "@trops/old-name",
        kind: "dashboard",
        version: "1.1.0",
        origin: "published",
      },
    };
    const plan = await planPackagePublish(dashboard({ record }), registry({}));
    assert.equal(plan.package, "@trops/old-name");
    assert.equal(plan.version, "1.1.0");
    assert.equal(plan.visibility, "private");
  });

  it("someone else's package it came from isn't where it goes", async () => {
    const record = {
      registryRef: {
        package: "@alice/home-lab",
        kind: "dashboard",
        version: "3.0.0",
        origin: "installed",
      },
    };
    const plan = await planPackagePublish(dashboard({ record }), registry({}));
    assert.equal(plan.package, "@trops/home-lab");
  });

  it("its own name now belongs to another kind: a free name", async () => {
    const record = {
      registryRef: {
        package: "@trops/home-lab",
        kind: "theme",
        version: "1.0.0",
        origin: "published",
      },
    };
    const plan = await planPackagePublish(
      {
        kind: "theme",
        displayName: "Home Lab",
        username: "trops",
        record,
      },
      registry({
        "@trops/home-lab": { type: "dashboard", versions: ["1.0.0"] },
      }),
    );
    assert.equal(plan.package, "@trops/home-lab-2");
    assert.equal(plan.renamed, true);
  });

  it("a sign-in the registry refused isn't a free name", async () => {
    const refused = (status) => async () => ({ status, ok: false });
    for (const status of [401, 403]) {
      assert.equal(
        await getPackageInfo("@trops/x", {
          fetch: refused(status),
          authFailuresUnreachable: true,
        }),
        "unreachable",
      );
    }
    assert.equal(
      await getPackageInfo("@trops/x", {
        fetch: refused(404),
        authFailuresUnreachable: true,
      }),
      null,
    );
  });

  it("a new package of something installed from someone else starts at 1.0.0", async () => {
    const record = {
      registryRef: {
        package: "@alice/home-lab",
        kind: "dashboard",
        version: "3.0.0",
        origin: "installed",
      },
    };
    const plan = await planPackagePublish(
      dashboard({ record, localVersion: "3.0.0" }),
      registry({}),
    );
    assert.equal(plan.version, "1.0.0");
  });

  it("can't ask the registry, or not signed in → an error, nothing guessed", async () => {
    const down = await planPackagePublish(
      dashboard(),
      async () => "unreachable",
    );
    assert.match(down.error, /Couldn't reach the registry/);
    const out = await planPackagePublish(
      dashboard({ username: "" }),
      registry({}),
    );
    assert.match(out.error, /Sign in/);
  });
});

describe("names and scopes", () => {
  // The registry's rule (dash-registry src/lib/validate.ts).
  const VALID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

  it("slugifyPackageName gives names the registry accepts", () => {
    const cases = {
      "Home Lab!": "home-lab",
      "Home - Lab": "home-lab",
      My_Theme: "my-theme",
      "2024 Plan": "dashboard-2024-plan",
      "  ": "dashboard",
      x: "dashboard",
      日本: "dashboard",
    };
    for (const [input, out] of Object.entries(cases)) {
      const slug = slugifyPackageName(input);
      assert.equal(slug, out, input);
      assert.match(slug, VALID, input);
    }
    assert.equal(slugifyPackageName("2024", "theme"), "theme-2024");
    const long = slugifyPackageName("a".repeat(30) + " " + "b".repeat(30));
    assert.ok(long.length <= 50 && VALID.test(long), long);
  });

  it("a suffix still fits the registry's 50 characters", () => {
    const base = slugifyPackageName("word ".repeat(20));
    const name = suffixedPackageName(base, 12);
    assert.ok(name.length <= 50, name);
    assert.match(name, /-12$/);
    assert.match(name, VALID);
  });

  it("localScopesOf: @ai-built plus scopes only built on this computer", () => {
    const scopes = localScopesOf(
      [
        { packageId: "@myco/x", installSource: "local" },
        { packageId: "@alice/slack", installSource: "registry" },
        { packageId: "@mixed/a", installSource: "local" },
        { packageId: "@mixed/b", installSource: "registry" },
        { packageId: "@trops/mine", installSource: "local" },
        { scope: "folder", copiedFromFolder: true },
      ],
      "trops",
    );
    assert.deepEqual(scopes.sort(), ["ai-built", "folder", "myco"]);
    assert.equal(publishScopeOf("myco", "trops", scopes), "trops");
    assert.equal(publishScopeOf("alice", "trops", scopes), "alice");
  });

  it("publishScopeOf: @ai-built goes out as the publisher; others keep theirs", () => {
    assert.equal(publishScopeOf("@ai-built", "trops"), "trops");
    assert.equal(publishScopeOf("alice", "trops"), "alice");
    assert.equal(publishScopeOf("@trops", "trops"), "trops");
    assert.equal(publishScopeOf("", "trops"), "");
  });
});

describe("generateRegistryManifest", () => {
  const config = {
    name: "Home Lab",
    widgets: [
      {
        id: "ai-built.lights.Lights",
        scope: "ai-built",
        packageName: "lights",
        version: "1.0.0",
      },
      {
        id: "alice.slack.Slack",
        scope: "alice",
        packageName: "slack",
        version: "2.0.0",
      },
    ],
  };

  it("leaves a third-party widget under its author", () => {
    const m = generateRegistryManifest(config, {
      callerScope: "trops",
      githubUser: "trops",
    });
    const pkgs = m.widgets.map((w) => w.package);
    assert.deepEqual(pkgs, ["@trops/lights", "@alice/slack"]);
  });

  it("takes a picked name, and omits visibility to keep the package's", () => {
    const kept = generateRegistryManifest(config, {
      packageName: "home-lab-2",
      keepVisibility: true,
    });
    assert.equal(kept.name, "home-lab-2");
    assert.equal("visibility" in kept, false);
    const fresh = generateRegistryManifest(config, { visibility: "private" });
    assert.equal(fresh.name, "home-lab");
    assert.equal(fresh.visibility, "private");
  });
});

describe("remapLayoutPackageScopes renames @ai-built everywhere it's named", () => {
  const ws = {
    layout: [
      {
        id: 3,
        type: "widget",
        workspace: "ai-built",
        component: "ai-built.lights.Lights",
        componentName: "ai-built.lights.Lights",
        packageId: "@ai-built/lights",
        listeners: {
          onToggle: [
            "ai-built.lights.Switch[4].toggled",
            "alice.slack.Slack[5].sent",
          ],
        },
      },
    ],
  };

  it("component, componentName, workspace and event wiring", () => {
    const out = remapLayoutPackageScopes(ws, "trops");
    const item = out.layout[0];
    assert.equal(item.component, "trops.lights.Lights");
    assert.equal(item.componentName, "trops.lights.Lights");
    assert.equal(item.workspace, "trops");
    assert.deepEqual(item.listeners.onToggle, [
      "trops.lights.Switch[4].toggled",
      "alice.slack.Slack[5].sent",
    ]);
    assert.doesNotThrow(() => assertNoLocalScopes(out));
  });

  it("the publish check catches what's left in componentName or wiring", () => {
    const leftover = {
      layout: [
        {
          id: 1,
          component: "trops.lights.Lights",
          componentName: "ai-built.lights.Lights",
        },
        {
          id: 2,
          component: "trops.x.X",
          listeners: { on: ["ai-built.lights.Switch[4].toggled"] },
        },
      ],
    };
    assert.throws(() => assertNoLocalScopes(leftover), /2 layout item\(s\)/);
  });
});

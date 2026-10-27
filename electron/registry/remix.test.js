/**
 * remix.test.js — what an item being published is a copy of (widgets,
 * dashboards, themes, bots, teams), and whether its author allows remixes.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { remixOrigin, checkRemix, checkRemixAll } = require("./remix");

const ME = "bob";

describe("remixOrigin", () => {
  it("a Widget Builder remix: the original it recorded", () => {
    assert.deepEqual(
      remixOrigin(
        "widget",
        {
          remixedFrom: { package: "@trops/chat", version: "0.0.9" },
          packageId: "@ai-built/chat-remix",
        },
        ME,
      ),
      { scope: "trops", name: "chat", version: "0.0.9" },
    );
  });

  it("someone else's widget installed from the registry, published as-is", () => {
    assert.deepEqual(
      remixOrigin(
        "widget",
        {
          packageId: "@alice/slack",
          version: "2.0.0",
          installSource: "registry",
        },
        ME,
      ),
      { scope: "alice", name: "slack", version: "2.0.0" },
    );
    // Installed before installSource was recorded: from the registry.
    assert.deepEqual(
      remixOrigin(
        "widget",
        { packageId: "@alice/slack", version: "2.0.0" },
        ME,
      ),
      { scope: "alice", name: "slack", version: "2.0.0" },
    );
    // A local build under that scope isn't from the registry.
    assert.equal(
      remixOrigin(
        "widget",
        { packageId: "@alice/slack", installSource: "local" },
        ME,
      ),
      null,
    );
  });

  it("the user's own work and local builds have no origin", () => {
    assert.equal(
      remixOrigin(
        "widget",
        { remixedFrom: { package: "@Bob/chat", version: "1.0.0" } },
        ME,
      ),
      null,
    );
    assert.equal(
      remixOrigin(
        "widget",
        { remixedFrom: { package: "@ai-built/x", version: "1.0.0" } },
        ME,
      ),
      null,
    );
    assert.equal(
      remixOrigin("widget", { remixedFrom: { package: "unknown" } }, ME),
      null,
    );
  });

  it("a dashboard installed from someone else", () => {
    const ws = {
      registryRef: {
        package: "@trops/kitchen-sink",
        kind: "dashboard",
        version: "1.0.0",
        origin: "installed",
      },
    };
    assert.deepEqual(remixOrigin("dashboard", ws, ME), {
      scope: "trops",
      name: "kitchen-sink",
      version: "1.0.0",
    });
    // Published from here: the user's own package.
    const published = {
      registryRef: {
        ...ws.registryRef,
        package: "@bob/kitchen-sink",
        origin: "published",
      },
    };
    assert.equal(remixOrigin("dashboard", published, ME), null);
    // A duplicate keeps pointing at the original.
    assert.deepEqual(
      remixOrigin(
        "dashboard",
        { remixedFrom: { package: "trops/kitchen-sink", version: null } },
        ME,
      ),
      { scope: "trops", name: "kitchen-sink", version: null },
    );
  });

  it("a theme installed from someone else; a dashboard imported from a file has none", () => {
    assert.deepEqual(
      remixOrigin(
        "theme",
        {
          version: "0.0.229",
          _registryMeta: {
            source: "registry",
            packageName: "trops/copper-canyon",
          },
        },
        ME,
      ),
      { scope: "trops", name: "copper-canyon", version: "0.0.229" },
    );
    assert.equal(remixOrigin("dashboard", { name: "From a file" }, ME), null);
  });

  it("bots and teams installed from someone else's package", () => {
    assert.deepEqual(
      remixOrigin(
        "bot",
        { installedFrom: { package: "alice/brief", version: "1.2.0" } },
        ME,
      ),
      { scope: "alice", name: "brief", version: "1.2.0" },
    );
    assert.deepEqual(
      remixOrigin(
        "bot-team",
        {
          registryRef: {
            package: "@alice/crew",
            kind: "bot-team",
            version: "3.0.0",
            origin: "installed",
          },
        },
        ME,
      ),
      { scope: "alice", name: "crew", version: "3.0.0" },
    );
  });
});

describe("checkRemix", () => {
  const origin = { scope: "trops", name: "kitchen-sink", version: null };
  const answer = (info) => async () => info;

  it("nothing to check without an origin", async () => {
    assert.deepEqual(await checkRemix(null, answer("unreachable")), {
      remixedFrom: null,
    });
  });

  it("allowed: the credit to send, at the version it was copied from when the registry has it", async () => {
    assert.deepEqual(
      await checkRemix(
        origin,
        answer({ allowRemix: true, latestVersion: "1.4.0" }),
      ),
      {
        remixedFrom: { scope: "trops", name: "kitchen-sink", version: "1.4.0" },
      },
    );
    assert.deepEqual(
      await checkRemix(
        { ...origin, version: "1.0.0" },
        answer({ latestVersion: "1.4.0", versions: ["1.4.0", "1.0.0"] }),
      ),
      {
        remixedFrom: { scope: "trops", name: "kitchen-sink", version: "1.0.0" },
      },
    );
    // A local version number that moved on: the registry's latest.
    assert.equal(
      (
        await checkRemix(
          { ...origin, version: "9.9.9" },
          answer({ latestVersion: "1.4.0", versions: ["1.4.0"] }),
        )
      ).remixedFrom.version,
      "1.4.0",
    );
  });

  it("refused when the author doesn't allow remixes", async () => {
    const res = await checkRemix(origin, answer({ allowRemix: false }));
    assert.match(res.error, /doesn't allow remixes/);
  });

  it("an original that's gone or private now is refused, not published uncredited", async () => {
    assert.match(
      (await checkRemix(origin, answer(null))).error,
      /isn't a package you can remix/,
    );
  });

  it("can't ask (or the sign-in wasn't accepted) → try again", async () => {
    assert.match(
      (await checkRemix(origin, answer("unreachable"))).error,
      /Couldn't check/,
    );
  });
});

describe("checkRemixAll (a team from several packages)", () => {
  const a = { scope: "alice", name: "brief", version: "1.0.0" };
  const c = { scope: "carol", name: "crew", version: "2.0.0" };
  const lookup = (infos) => async (pkg) => infos[pkg];

  it("refused if any original refuses", async () => {
    const res = await checkRemixAll(
      [a, c],
      lookup({
        "@alice/brief": { allowRemix: true, latestVersion: "1.0.0" },
        "@carol/crew": { allowRemix: false },
      }),
    );
    assert.match(res.error, /@carol\/crew/);
  });

  it("credits the one credited before, else the first by name", async () => {
    const infos = lookup({
      "@alice/brief": { latestVersion: "1.0.0" },
      "@carol/crew": { latestVersion: "2.0.0" },
    });
    assert.equal(
      (await checkRemixAll([c, null, a], infos)).remixedFrom.scope,
      "alice",
    );
    assert.equal(
      (await checkRemixAll([c, a], infos, c)).remixedFrom.scope,
      "carol",
    );
    assert.deepEqual(await checkRemixAll([null], infos), { remixedFrom: null });
  });
});

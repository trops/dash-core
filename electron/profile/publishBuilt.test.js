/**
 * publishBuilt.test.js — the Widget Builder's publish prompt: what it can
 * publish (and as what), private by default, the public choice passed on,
 * and the personal-folder check.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { planBuiltPublish, publishBuilt } = require("./publishBuilt");
const { planPublish } = require("./profilePublish");

function deps(over = {}) {
  const calls = [];
  const installed = {
    "@ai-built/smart-lights": { version: "0.1.0", scope: "ai-built" },
    // Just installed: listed by its bare name until the next launch.
    weather: { version: "1.0.0", scope: "trops" },
    "@alice/theirs": { version: "2.0.0", scope: "alice" },
  };
  const info = over.info || {};
  const d = {
    username: async () => ("user" in over ? over.user : "trops"),
    registry: () => ({ getWidget: (p) => installed[p] || null }),
    lookup: async (pkg) => (pkg in info ? info[pkg] : null),
    planPublish,
    publishWidget: async (win, appId, row, opts) => {
      calls.push([row, opts]);
      return (
        over.publishResult || {
          status: "published",
          publishedAs: row.publishAs,
          version: row.version,
          dashboardsSwitched: 1,
        }
      );
    },
  };
  return { d, calls };
}

describe("planBuiltPublish", () => {
  it("an AI-built widget becomes the user's, private when new", async () => {
    const { d } = deps();
    const plan = await planBuiltPublish("@ai-built/smart-lights", d);
    assert.equal(plan.success, true);
    assert.equal(plan.publishable, true);
    assert.equal(plan.publishAs, "@trops/smart-lights");
    assert.equal(plan.version, "0.1.0");
    assert.equal(plan.exists, false);
    assert.equal(plan.visibility, "private");
  });

  it("already public: says so (the toggle starts there), and the next free version", async () => {
    const { d } = deps({
      info: {
        "@trops/smart-lights": {
          versions: ["0.1.0"],
          latestVersion: "0.1.0",
          visibility: "public",
          type: "widget",
        },
      },
    });
    const plan = await planBuiltPublish("@ai-built/smart-lights", d);
    assert.equal(plan.exists, true);
    assert.equal(plan.visibility, "public");
    assert.equal(plan.version, "0.1.1");
  });

  it("a widget just installed under its bare name is found", async () => {
    const { d } = deps();
    const plan = await planBuiltPublish("@trops/weather", d);
    assert.equal(plan.success, true);
    assert.equal(plan.publishable, true);
  });

  it("someone else's, not installed, or signed out: says why", async () => {
    const { d } = deps();
    const theirs = await planBuiltPublish("@alice/theirs", d);
    assert.equal(theirs.publishable, false);
    assert.match(theirs.reason, /someone else/);
    const missing = await planBuiltPublish("@ai-built/nope", d);
    assert.match(missing.error, /isn't installed/);
    const { d: out } = deps({ user: null });
    assert.equal(
      (await planBuiltPublish("@ai-built/smart-lights", out)).signInRequired,
      true,
    );
  });
});

describe("why it can't publish now, in the Builder's words", () => {
  it("the name is another kind of package of theirs, or the account is out of reach", async () => {
    const { d } = deps({
      info: {
        "@trops/smart-lights": { versions: ["1.0.0"], type: "dashboard" },
      },
    });
    const taken = await planBuiltPublish("@ai-built/smart-lights", d);
    assert.equal(taken.why, "name-taken");
    assert.match(
      taken.reason,
      /already the name of a dashboard you published — rename the widget/,
    );
    const { d: d2 } = deps({ info: { "@trops/smart-lights": "unreachable" } });
    const away = await planBuiltPublish("@ai-built/smart-lights", d2);
    assert.equal(away.why, "unreachable");
    assert.match(away.reason, /publish it later from the Widgets page/);
  });
});

describe("publishBuilt", () => {
  it("private unless public is asked for", async () => {
    const { d, calls } = deps();
    const res = await publishBuilt(
      null,
      "app",
      "@ai-built/smart-lights",
      {},
      d,
    );
    assert.equal(res.success, true);
    assert.equal(res.visibility, "private");
    assert.equal(calls[0][0].visibility, "private");
    assert.equal(calls[0][0].publishAs, "@trops/smart-lights");
    assert.deepEqual(calls[0][1], { confirmPersonalPaths: false });

    const { d: d2, calls: calls2 } = deps();
    await publishBuilt(
      null,
      "app",
      "@ai-built/smart-lights",
      { visibility: "public", confirmPersonalPaths: true },
      d2,
    );
    assert.equal(calls2[0][0].visibility, "public");
    assert.deepEqual(calls2[0][1], { confirmPersonalPaths: true });
  });

  it("files that mention this computer's folders: asks first", async () => {
    const { d } = deps({
      publishResult: {
        status: "needs-confirmation",
        findings: [{ file: "a.js", match: "/Users/me" }],
      },
    });
    const res = await publishBuilt(
      null,
      "app",
      "@ai-built/smart-lights",
      {},
      d,
    );
    assert.equal(res.success, false);
    assert.equal(res.status, "needs-confirmation");
    assert.equal(res.findings.length, 1);
  });

  it("someone else's is never published", async () => {
    const { d, calls } = deps();
    const res = await publishBuilt(null, "app", "@alice/theirs", {}, d);
    assert.equal(res.success, false);
    assert.equal(calls.length, 0);
  });
});

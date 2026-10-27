/**
 * registryPackages.test.js — what the registry knows about a package (with
 * a fake fetch), the next version to publish, and the kind check.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  getPackageInfo,
  nextFreeVersion,
  kindConflict,
} = require("./registryPackages");

function fakeFetch(status, body, seen = []) {
  return async (url) => {
    seen.push(url);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    };
  };
}

describe("getPackageInfo", () => {
  it("returns the kind, versions, latest and visibility", async () => {
    const seen = [];
    const info = await getPackageInfo("trops/kitchen", {
      fetch: fakeFetch(
        200,
        {
          type: "dashboard",
          latestVersion: "1.2.0",
          visibility: "private",
          versions: [{ version: "1.2.0" }, { version: "1.1.0" }, {}],
        },
        seen,
      ),
    });
    assert.match(seen[0], /\/api\/packages\/trops\/kitchen$/);
    assert.deepEqual(info, {
      package: "@trops/kitchen",
      scope: "trops",
      name: "kitchen",
      type: "dashboard",
      latestVersion: "1.2.0",
      versions: ["1.2.0", "1.1.0"],
      visibility: "private",
    });
  });

  it("a package published before kinds existed is a widget", async () => {
    const info = await getPackageInfo("@trops/chat", {
      fetch: fakeFetch(200, { latestVersion: "0.0.1", versions: [] }),
    });
    assert.equal(info.type, "widget");
  });

  it("not there or not yours → null; can't ask → unreachable", async () => {
    for (const status of [404, 401, 403]) {
      assert.equal(
        await getPackageInfo("@trops/x", { fetch: fakeFetch(status, {}) }),
        null,
      );
    }
    assert.equal(
      await getPackageInfo("@trops/x", { fetch: fakeFetch(500, {}) }),
      "unreachable",
    );
    assert.equal(
      await getPackageInfo("@trops/x", {
        fetch: async () => {
          throw new Error("offline");
        },
      }),
      "unreachable",
    );
  });

  it("never asks about a name it can't place", async () => {
    const seen = [];
    assert.equal(
      await getPackageInfo("kitchen", { fetch: fakeFetch(200, {}, seen) }),
      null,
    );
    assert.equal(seen.length, 0);
  });
});

describe("nextFreeVersion", () => {
  it("keeps this computer's version when the registry doesn't have it", () => {
    assert.equal(nextFreeVersion("1.4.0", { versions: ["1.3.2"] }), "1.4.0");
    assert.equal(nextFreeVersion("1.4.0", null), "1.4.0");
  });
  it("moves past a taken or newer version", () => {
    assert.equal(nextFreeVersion("1.0.0", { versions: ["1.0.0"] }), "1.0.1");
    assert.equal(nextFreeVersion("1.0.0", { versions: ["2.1.0"] }), "2.1.1");
  });
  it("can't ask the registry → this computer's version", () => {
    assert.equal(nextFreeVersion("1.0.3", "unreachable"), "1.0.3");
    assert.equal(nextFreeVersion(null, "unreachable"), "1.0.0");
  });
});

describe("kindConflict", () => {
  it("a new package, or one of the same kind, is fine", () => {
    assert.equal(kindConflict("@trops/k", "dashboard", null), null);
    assert.equal(
      kindConflict("@trops/k", "dashboard", { type: "dashboard" }),
      null,
    );
    assert.equal(kindConflict("@trops/k", "widget", { type: undefined }), null);
  });
  it("another kind under the name is refused, like the registry does", () => {
    assert.match(
      kindConflict("trops/k", "dashboard", { type: "widget" }),
      /"@trops\/k" is already a widget package — a dashboard can't/,
    );
    assert.ok(kindConflict("@trops/k", "bot", { type: "bot-team" }));
  });
});

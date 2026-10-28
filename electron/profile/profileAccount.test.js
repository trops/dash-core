/**
 * profileAccount.test.js — profiles kept in the account: the link from a
 * profile here to its account copy, and the registry calls (signed out,
 * unreachable, refused because another computer saved since).
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const account = require("./profileAccount");

const appId = "@trops/dash-electron";
let dir;
const deps = (extra = {}) => ({
  appDataDir: () => dir,
  signedIn: () => true,
  baseUrl: () => "https://registry.test",
  ...extra,
});

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-account-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("links", () => {
  it("records, moves and forgets the account copy a profile is linked to", () => {
    const d = deps();
    assert.equal(account.getLink(appId, "ann", "default", d), null);
    account.setLink(
      appId,
      "ann",
      "default",
      { accountId: "a1", revision: 2 },
      d,
    );
    assert.equal(account.getLink(appId, "ann", "default", d).revision, 2);
    assert.equal(account.profileFor(appId, "ann", "a1", d), "default");
    // One profile here per account copy: linking it again moves the link.
    account.setLink(
      appId,
      "ann",
      "p-mini",
      { accountId: "a1", revision: "3" },
      d,
    );
    assert.equal(account.getLink(appId, "ann", "default", d), null);
    assert.equal(account.getLink(appId, "ann", "p-mini", d).revision, 3);
    account.clearLink(appId, "ann", "p-mini", d);
    assert.deepEqual(account.allLinks(appId, "ann", d), {});
  });

  it("links belong to the user who made them", () => {
    const d = deps();
    account.setLink(
      appId,
      "Ann",
      "p-mini",
      { accountId: "a1", revision: 1 },
      d,
    );
    assert.equal(account.getLink(appId, "ann", "p-mini", d).accountId, "a1");
    assert.equal(account.getLink(appId, "bob", "p-mini", d), null);
    assert.equal(account.getLink(appId, null, "p-mini", d), null);
    // Bob linking the same profile leaves Ann's link alone.
    account.setLink(
      appId,
      "bob",
      "p-mini",
      { accountId: "b1", revision: 1 },
      d,
    );
    assert.equal(account.getLink(appId, "ann", "p-mini", d).accountId, "a1");
    // Deleting the profile forgets it for everyone.
    account.forgetProfile(appId, "p-mini", d);
    assert.equal(account.getLink(appId, "ann", "p-mini", d), null);
    assert.equal(account.getLink(appId, "bob", "p-mini", d), null);
  });

  it("a load links only when nothing else holds the copy and the target isn't linked elsewhere", () => {
    const d = deps();
    // Nothing linked: link.
    assert.equal(
      account.shouldLinkAfterLoad(appId, "ann", "p-x", "a1", d),
      true,
    );
    account.setLink(
      appId,
      "ann",
      "default",
      { accountId: "a1", revision: 1 },
      d,
    );
    // Default holds a1: loading it as its own profile leaves Default linked.
    assert.equal(
      account.shouldLinkAfterLoad(appId, "ann", "p-x", "a1", d),
      false,
    );
    // The holder itself: refresh.
    assert.equal(
      account.shouldLinkAfterLoad(appId, "ann", "default", "a1", d),
      true,
    );
    // A profile linked to another copy isn't taken over.
    account.setLink(appId, "ann", "p-y", { accountId: "a2", revision: 1 }, d);
    assert.equal(
      account.shouldLinkAfterLoad(appId, "ann", "p-y", "a3", d),
      false,
    );
    assert.equal(
      account.shouldLinkAfterLoad(appId, null, "p-z", "a3", d),
      false,
    );
  });

  it("after a load: in step only when everything loaded", () => {
    const from = { accountId: "a1", revision: 4, updatedOn: "laptop" };
    const digest = { dashboards: {} };
    assert.deepEqual(account.linkAfterLoad(from, [], digest), {
      ...from,
      digest,
    });
    // Something didn't load: no revision, so it reads as not in step.
    assert.equal(
      account.linkAfterLoad(from, ["Kitchen: not shared with you"], digest)
        .revision,
      null,
    );
  });

  it("a damaged or crafted file links nothing", () => {
    const d = deps();
    fs.writeFileSync(path.join(dir, "profileAccounts.json"), "{nope");
    assert.deepEqual(account.allLinks(appId, "ann", d), {});
    fs.writeFileSync(
      path.join(dir, "profileAccounts.json"),
      JSON.stringify({ ann: { x: { accountId: "../etc" }, y: null } }),
    );
    assert.deepEqual(account.allLinks(appId, "ann", d), {});
  });

  it("new account ids are ones the registry accepts", () => {
    assert.match(account.newAccountId(), account.ACCOUNT_ID_PATTERN);
  });
});

describe("the account", () => {
  it("signed out: asks to sign in, without calling the registry", async () => {
    let called = false;
    const d = deps({
      signedIn: () => false,
      authedFetch: async () => {
        called = true;
      },
    });
    const res = await account.listRemote(d);
    assert.equal(res.success, false);
    assert.equal(res.signInRequired, true);
    assert.equal(called, false);
  });

  it("lists profiles, dropping any with an odd id", async () => {
    const d = deps({
      authedFetch: async (url) => {
        assert.equal(url, "https://registry.test/api/auth/me/profiles");
        return reply(200, {
          profiles: [
            { id: "a1", name: "Mac Mini", revision: 2 },
            { id: "../x", name: "Bad" },
            { id: "a2", name: { evil: true }, revision: "2" },
          ],
        });
      },
    });
    const res = await account.listRemote(d);
    assert.deepEqual(
      res.profiles.map((p) => p.id),
      ["a1", "a2"],
    );
    // Shown text is checked: an odd name is replaced, revisions are numbers.
    assert.equal(res.profiles[1].name, "Untitled profile");
    assert.equal(res.profiles[1].revision, 2);
  });

  it("saves with the revision last seen; a refusal says what the account has", async () => {
    let sent = null;
    const ok = await account.putRemote(
      "a1",
      { name: "Mac Mini" },
      2,
      deps({
        authedFetch: async (url, opts) => {
          sent = { url, method: opts.method, body: JSON.parse(opts.body) };
          return reply(200, { id: "a1", revision: 3 });
        },
      }),
    );
    assert.equal(ok.success, true);
    assert.equal(sent.method, "PUT");
    assert.equal(sent.url, "https://registry.test/api/auth/me/profiles/a1");
    assert.equal(sent.body.baseRevision, 2);

    const newer = await account.putRemote(
      "a1",
      {},
      2,
      deps({
        authedFetch: async () =>
          reply(409, {
            error: "newer",
            revision: 4,
            updatedOn: "laptop",
            updatedAt: "2026-10-27T09:00:00.000Z",
          }),
      }),
    );
    assert.equal(newer.success, false);
    assert.deepEqual(newer.conflict, {
      revision: 4,
      updatedOn: "laptop",
      updatedAt: "2026-10-27T09:00:00.000Z",
      missing: false,
    });

    const gone = await account.putRemote(
      "a1",
      {},
      2,
      deps({ authedFetch: async () => reply(409, { error: "gone" }) }),
    );
    assert.equal(gone.conflict.missing, true);
  });

  it("unreachable, or an id that isn't one, fails plainly", async () => {
    const down = await account.getRemote(
      "a1",
      deps({
        authedFetch: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    assert.equal(down.unreachable, true);
    let called = false;
    const bad = await account.deleteRemote(
      "../a",
      deps({
        authedFetch: async () => {
          called = true;
        },
      }),
    );
    assert.equal(bad.success, false);
    assert.equal(called, false);
  });
});

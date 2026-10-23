/**
 * registryDownload — signed out downloads go without a sign-in; a refused
 * sign-in is cleared and the download tried once more without it.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createRegistryDownload,
  downloadRefusal,
  INSTALL_ID_HEADER,
} = require("./registryDownload");

function setup({ token = null, statuses = [200] } = {}) {
  const calls = [];
  let stored = token ? { token } : null;
  const respond = () => ({
    status: statuses[Math.min(calls.length - 1, statuses.length - 1)],
  });
  const dl = createRegistryDownload({
    authedFetch: async (url, opts) => {
      const headers = { ...opts.headers };
      if (stored) headers.Authorization = `Bearer ${stored.token}`;
      calls.push({ url, headers });
      return respond();
    },
    getStoredToken: () => stored,
    fetchImpl: async (url, opts) => {
      calls.push({ url, headers: { ...opts.headers } });
      return respond();
    },
    installId: () => "id-1",
  });
  return { dl, calls };
}

describe("registryDownloadFetch", () => {
  it("signed out: one request, no sign-in, with the install ID", async () => {
    const { dl, calls } = setup();
    const { response, expired } = await dl.registryDownloadFetch("u");
    assert.equal(response.status, 200);
    assert.equal(expired, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.equal(calls[0].headers[INSTALL_ID_HEADER], "id-1");
  });

  it("signed in: sends the sign-in", async () => {
    const { dl, calls } = setup({ token: "t" });
    await dl.registryDownloadFetch("u");
    assert.equal(calls[0].headers.Authorization, "Bearer t");
  });

  it("a refused sign-in: the download is tried without it (public still installs), the sign-in kept", async () => {
    const { dl, calls } = setup({
      token: "dead",
      statuses: [401, 200],
    });
    const { response, expired } = await dl.registryDownloadFetch("u");
    assert.equal(expired, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].headers.Authorization, undefined);
    assert.equal(response.status, 200);
  });

  it("signed out and refused: no second try", async () => {
    const { dl, calls } = setup({ statuses: [401] });
    const { expired } = await dl.registryDownloadFetch("u");
    assert.equal(calls.length, 1);
    assert.equal(expired, false);
  });
});

describe("purpose", () => {
  it("a preview says so in the URL, keeping its other parameters", async () => {
    const { dl, calls } = setup();
    await dl.registryDownloadFetch(
      "https://r.test/api/packages/a/b/download?version=1.0.0",
      {
        purpose: "preview",
      },
    );
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("purpose"), "preview");
    assert.equal(u.searchParams.get("version"), "1.0.0");
  });

  it("an install doesn't", async () => {
    const { dl, calls } = setup();
    await dl.registryDownloadFetch("https://r.test/x/download");
    assert.equal(calls[0].url, "https://r.test/x/download");
  });
});

describe("downloadRefusal", () => {
  it("401: sign in (or sign in again when it expired)", () => {
    assert.deepEqual(downloadRefusal({ status: 401 }), {
      error: "Sign in to the Dash registry to install this.",
      authRequired: true,
    });
    assert.match(
      downloadRefusal({ status: 401 }, { expired: true }).error,
      /session expired\. Sign in again/,
    );
  });

  it("429: try again later; other statuses: nothing", () => {
    assert.match(
      downloadRefusal({ status: 429 }).error,
      /try again in a few minutes/,
    );
    assert.equal(downloadRefusal({ status: 200 }), null);
    assert.equal(downloadRefusal({ status: 500 }), null);
  });
});

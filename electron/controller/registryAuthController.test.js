/**
 * registryAuthController.test.js
 *
 * Pins the Cognito access-token auto-refresh added to the registry auth
 * controller. registryAuthController.js requires "electron" at module load
 * (not installed in dash-core), so we extract just the three refresh-related
 * functions and re-evaluate them with injected dependencies — same pattern as
 * mcpController.test.js.
 *
 * Covers:
 *   - isAccessTokenExpired: past exp → true, future → false, garbage → false
 *   - refreshAccessToken: mints + stores a new access token from Cognito;
 *     returns false with no refresh token or when Cognito rejects it
 *   - authedFetch: injects Bearer; on 401 refreshes once + retries; surfaces
 *     the 401 when refresh fails
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// Extract isAccessTokenExpired + refreshAccessToken + authedFetch (contiguous
// block) and eval with injected fetch / getStore / getStoredToken.
const source = fs.readFileSync(
  path.join(__dirname, "registryAuthController.js"),
  "utf8",
);
const start = source.indexOf("function isAccessTokenExpired(");
const end = source.indexOf("function getStoredToken(");
const block = source.substring(start, end);

function buildModule({ fetchImpl, store }) {
  const getStore = () => store;
  const getStoredToken = () => {
    const token = store.get("accessToken");
    return token ? { token, userId: store.get("userId") } : null;
  };
  // eslint-disable-next-line no-new-func
  return new Function(
    "fetch",
    "getStore",
    "getStoredToken",
    `${block}\n return { isAccessTokenExpired, refreshAccessToken, authedFetch };`,
  )(fetchImpl, getStore, getStoredToken);
}

function makeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (k) => map.get(k),
    set: (k, v) => map.set(k, v),
    _map: map,
  };
}

function jwtWithExp(expSeconds) {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString(
    "base64",
  );
  return `header.${payload}.sig`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

test("isAccessTokenExpired: past exp → true, future → false, garbage → false", () => {
  const { isAccessTokenExpired } = buildModule({
    fetchImpl: async () => ({}),
    store: makeStore(),
  });
  assert.strictEqual(isAccessTokenExpired(jwtWithExp(past())), true);
  assert.strictEqual(isAccessTokenExpired(jwtWithExp(future())), false);
  assert.strictEqual(isAccessTokenExpired("not-a-jwt"), false);
});

test("refreshAccessToken: stores a new access token from Cognito InitiateAuth", async () => {
  let captured = null;
  const store = makeStore({
    refreshToken: "rt-123",
    cognitoClientId: "client-abc",
    cognitoRegion: "us-east-1",
    accessToken: "old-access",
  });
  const { refreshAccessToken } = buildModule({
    fetchImpl: async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        json: async () => ({
          AuthenticationResult: { AccessToken: "fresh-access" },
        }),
      };
    },
    store,
  });

  const ok = await refreshAccessToken();
  assert.strictEqual(ok, true);
  assert.strictEqual(store.get("accessToken"), "fresh-access");
  assert.match(captured.url, /cognito-idp\.us-east-1\.amazonaws\.com/);
  const body = JSON.parse(captured.opts.body);
  assert.strictEqual(body.AuthFlow, "REFRESH_TOKEN_AUTH");
  assert.strictEqual(body.ClientId, "client-abc");
  assert.strictEqual(body.AuthParameters.REFRESH_TOKEN, "rt-123");
});

test("refreshAccessToken: returns false when there is no stored refresh token", async () => {
  const { refreshAccessToken } = buildModule({
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
    store: makeStore({ accessToken: "old" }),
  });
  assert.strictEqual(await refreshAccessToken(), false);
});

test("refreshAccessToken: returns false when Cognito rejects the refresh token", async () => {
  const store = makeStore({
    refreshToken: "expired",
    cognitoClientId: "client-abc",
  });
  const { refreshAccessToken } = buildModule({
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    store,
  });
  assert.strictEqual(await refreshAccessToken(), false);
  // Old access token (none here) untouched — nothing written.
  assert.strictEqual(store.get("accessToken"), undefined);
});

test("authedFetch: injects Bearer and does not refresh a healthy token", async () => {
  const calls = [];
  const store = makeStore({ accessToken: jwtWithExp(future()) });
  const { authedFetch } = buildModule({
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { status: 200 };
    },
    store,
  });

  const res = await authedFetch("https://reg/api/packages");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].opts.headers.Authorization,
    `Bearer ${store.get("accessToken")}`,
  );
});

test("authedFetch: on 401 refreshes once and retries with the new token", async () => {
  const calls = [];
  const store = makeStore({
    accessToken: jwtWithExp(future()),
    refreshToken: "rt-123",
    cognitoClientId: "client-abc",
  });
  const { authedFetch } = buildModule({
    fetchImpl: async (url, opts) => {
      // Cognito refresh call (no Authorization header, has X-Amz-Target).
      if (url.includes("cognito-idp")) {
        return {
          ok: true,
          json: async () => ({
            AuthenticationResult: { AccessToken: "fresh-access" },
          }),
        };
      }
      calls.push({ url, opts });
      // First registry call 401s; retry (after refresh) succeeds.
      return { status: calls.length === 1 ? 401 : 200 };
    },
    store,
  });

  const res = await authedFetch("https://reg/api/packages");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(calls.length, 2);
  // Retry used the refreshed token.
  assert.strictEqual(
    calls[1].opts.headers.Authorization,
    "Bearer fresh-access",
  );
});

test("authedFetch: returns the 401 when refresh fails (no refresh token)", async () => {
  const calls = [];
  const store = makeStore({ accessToken: jwtWithExp(future()) });
  const { authedFetch } = buildModule({
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { status: 401 };
    },
    store,
  });

  const res = await authedFetch("https://reg/api/packages");
  assert.strictEqual(res.status, 401);
  // One attempt; no refresh token → no retry.
  assert.strictEqual(calls.length, 1);
});

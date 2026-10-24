/**
 * mcpOAuthProvider.js
 *
 * Implements the MCP SDK's `OAuthClientProvider` interface for custom
 * remote (streamable_http) MCP servers that authenticate with standard
 * OAuth 2.0 (e.g. Granola, Linear). This is the generic, SDK-native
 * alternative to the catalog-only subprocess auth model (`runAuth`)
 * used by the bundled Google servers.
 *
 * Flow (driven by mcpController.connectStreamableHttpWithOAuth):
 *   1. A loopback HTTP server is started on 127.0.0.1:<ephemeral> to
 *      catch the OAuth redirect. `redirectUrl` reflects that port.
 *   2. On first connect with no/expired tokens, the SDK calls
 *      `redirectToAuthorization`, which opens the system browser.
 *   3. The user consents; the authorization server redirects back to the
 *      loopback `/callback?code=...`, which resolves `_waitForCode()`.
 *   4. The controller calls `transport.finishAuth(code)` → `saveTokens`.
 *
 * Tokens, Dynamic Client Registration info, and the PKCE verifier are
 * persisted encrypted in the SAME providers.json store as credentials
 * (via providerController), keyed by (appId, serverName). They are never
 * returned to the renderer.
 */
const { shell } = require("electron");
const http = require("http");
const providerController = require("../controller/providerController");

/**
 * Start a loopback HTTP server on 127.0.0.1 — on an OS-assigned port, or on
 * `port` when the provider's app has a callback URL registered (e.g.
 * Salesforce's External Client App: http://localhost:<port>/callback). A
 * fixed port also listens on ::1, since "localhost" may resolve to either.
 * Resolves once listening with `{ server, servers, port, codePromise }`
 * where `codePromise` resolves with the OAuth `code` (or rejects on
 * `error`).
 */
function startLoopbackServer(port = 0) {
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url, "http://127.0.0.1");
      if (reqUrl.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const error = reqUrl.searchParams.get("error");
      const code = reqUrl.searchParams.get("code");
      const heading = error ? "Authorization failed" : "Authorization complete";
      const body = error
        ? "You can close this window and try again in Dash."
        : "You can close this window and return to Dash.";
      const html =
        "<!doctype html><html><head><meta charset='utf-8'>" +
        "<title>Dash</title></head>" +
        "<body style='font-family:system-ui,sans-serif;background:#111;color:#eee;" +
        "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'>" +
        `<div style='text-align:center;'><h2>${heading}</h2><p>${body}</p></div>` +
        "</body></html>";
      res.writeHead(error ? 400 : 200, { "Content-Type": "text/html" });
      res.end(html);

      if (error) {
        rejectCode(new Error(`OAuth authorization error: ${error}`));
      } else if (code) {
        resolveCode(code);
      } else {
        rejectCode(new Error("OAuth callback missing authorization code"));
      }
    } catch (e) {
      rejectCode(e);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      reject(
        port && err && err.code === "EADDRINUSE"
          ? new Error(
              `Port ${port} is in use, so Dash can't receive the sign-in. Finish or close the other sign-in using it (another app, or another Dash sign-in) and try again.`,
            )
          : err,
      );
    });
    // Bind to loopback only (never 0.0.0.0) — port 0 = OS-assigned.
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const servers = [server];
      const done = () =>
        resolve({ server, servers, port: addr.port, codePromise });
      if (!port) return done();
      // The IPv6 loopback too (best effort: no IPv6, or it's taken).
      const v6 = http.createServer((req, res) =>
        server.emit("request", req, res),
      );
      v6.once("error", () => done());
      v6.listen(port, "::1", () => {
        servers.push(v6);
        done();
      });
    });
  });
}

/**
 * The OAuth settings with a provider's own fields filled in ({{clientId}},
 * {{callbackPort}}, …) — the way its URL and headers are. A port left empty
 * falls back to `oauth.defaults.callbackPort`; one that isn't a port number
 * means an OS-assigned port.
 *
 * @param {object} oauth  mcpConfig.oauth
 * @param {object} credentials  the provider's saved fields
 * @returns {{ oauth: object, missing: string[] }}  missing: fields the
 *   client id / secret need that are empty
 */
function resolveOAuthConfig(oauth, credentials) {
  const src = oauth || {};
  const creds = credentials || {};
  const missing = [];
  const fill = (v, { track = false } = {}) => {
    if (typeof v !== "string") return v;
    let empty = false;
    const out = v.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
      const val = creds[key];
      if (val === undefined || val === null || String(val).trim() === "") {
        empty = true;
        if (track) missing.push(key);
        return "";
      }
      return String(val).trim();
    });
    return empty && out === "" ? undefined : out;
  };
  const resolved = { ...src };
  delete resolved.defaults;
  for (const key of ["clientId", "clientSecret"]) {
    if (key in src)
      resolved[key] = fill(src[key], { track: key === "clientId" });
  }
  if ("scopes" in src) resolved.scopes = fill(src.scopes);
  if ("callbackPort" in src) {
    const raw = fill(src.callbackPort);
    const fallback = src.defaults && src.defaults.callbackPort;
    const n = Number(raw === undefined ? fallback : raw);
    resolved.callbackPort =
      Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : undefined;
  }
  return { oauth: resolved, missing };
}

/**
 * Create an OAuthClientProvider for one (appId, serverName) pair.
 *
 * @param {object} args
 * @param {BrowserWindow|null} args.win unused today; reserved for future
 *   window-scoped flows.
 * @param {string} args.appId application id (providers.json namespace)
 * @param {string} args.serverName provider/server name (storage key)
 * @param {object} args.mcpConfig the server config; `mcpConfig.oauth` may
 *   carry `{ scopes, clientId?, clientSecret? }`.
 */
function createMcpOAuthProvider({ win, appId, serverName, mcpConfig }) {
  const oauth = (mcpConfig && mcpConfig.oauth) || {};

  // Lazy-hydrated cache of persisted { tokens, clientInformation, codeVerifier }.
  let state = null;
  const load = () => {
    if (state) return state;
    const res = providerController.getOAuthState(win, appId, serverName);
    state = (res && res.oauth) || {};
    return state;
  };
  const persist = (patch) => {
    state = { ...load(), ...patch };
    providerController.saveOAuthState(win, appId, serverName, state);
  };

  // Loopback server for the current flow (null when idle).
  let loopback = null;
  // A connect is under way (the controller waits for a sign-in's code). A
  // provider with a fixed callback port only takes the port then, when the
  // browser actually opens — not on every connect with valid tokens.
  let inFlow = false;

  return {
    get redirectUrl() {
      // A fixed port is registered with the provider as "localhost" (e.g.
      // Salesforce's External Client App); it must match exactly, and is
      // known before anything listens on it.
      if (oauth.callbackPort) {
        return `http://localhost:${oauth.callbackPort}/callback`;
      }
      // Outside a sign-in there's no port yet, but the SDK must still see
      // a redirect URL: without one it takes the provider for a
      // non-interactive client and never refreshes an expired token
      // (QA 2026-10-24). No browser opens outside a sign-in, and a client
      // registered with this URL isn't saved (saveClientInformation).
      if (!loopback) return "http://127.0.0.1/callback";
      return `http://127.0.0.1:${loopback.port}/callback`;
    },

    get clientMetadata() {
      const redirectUrl = this.redirectUrl;
      return {
        client_name: `Dash – ${serverName}`,
        redirect_uris: redirectUrl ? [redirectUrl] : [],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: oauth.clientSecret
          ? "client_secret_post"
          : "none",
        ...(oauth.scopes ? { scope: oauth.scopes } : {}),
      };
    },

    clientInformation() {
      // Pre-registered (manual) client wins over Dynamic Client Registration.
      if (oauth.clientId) {
        return {
          client_id: oauth.clientId,
          ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}),
        };
      }
      return load().clientInformation;
    },

    saveClientInformation(clientInformation) {
      // Registered outside a sign-in (the SDK re-registers when a refresh
      // finds the client gone), it carries the port-less placeholder
      // redirect URL: don't keep it, so the next sign-in registers with
      // its real one.
      if (!inFlow && !oauth.callbackPort) return;
      persist({ clientInformation });
    },

    tokens() {
      return load().tokens;
    },

    // Called by the SDK on initial authorization AND on every refresh.
    saveTokens(tokens) {
      persist({ tokens });
    },

    saveCodeVerifier(codeVerifier) {
      persist({ codeVerifier });
    },

    codeVerifier() {
      const v = load().codeVerifier;
      if (!v) throw new Error("No OAuth code verifier saved");
      return v;
    },

    async redirectToAuthorization(authorizationUrl) {
      // Outside a connect nobody waits for the code (e.g. a token that
      // couldn't be refreshed mid-session): don't open a sign-in that goes
      // nowhere — the next connect signs in again.
      if (!inFlow) return;
      if (oauth.callbackPort) {
        // Take the port only now, when the sign-in really opens.
        if (!loopback) {
          loopback = await startLoopbackServer(oauth.callbackPort);
        }
      }
      await shell.openExternal(authorizationUrl.toString());
    },

    // Lets the SDK clear bad credentials so the next attempt re-auths
    // without manual intervention (e.g. refresh token revoked).
    invalidateCredentials(scope) {
      if (scope === "all" || scope === "tokens") persist({ tokens: undefined });
      if (scope === "all" || scope === "client")
        persist({ clientInformation: undefined });
      if (scope === "all" || scope === "verifier")
        persist({ codeVerifier: undefined });
    },

    // --- helpers used by the controller (not part of the SDK interface) ---

    async _startLoopback() {
      inFlow = true;
      // A fixed port is taken when the browser opens (redirectToAuthorization).
      if (!loopback && !oauth.callbackPort) {
        loopback = await startLoopbackServer(0);
      }
      return loopback;
    },

    _stopLoopback() {
      inFlow = false;
      if (loopback) {
        for (const s of loopback.servers || [loopback.server]) {
          try {
            s.close();
          } catch (_e) {
            /* already closing */
          }
        }
        loopback = null;
      }
    },

    _waitForCode(timeoutMs = 120000) {
      if (!loopback) {
        return Promise.reject(new Error("OAuth loopback server not started"));
      }
      return Promise.race([
        loopback.codePromise,
        new Promise((_resolve, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "OAuth authorization timed out. Close the browser tab and try again.",
                ),
              ),
            timeoutMs,
          ),
        ),
      ]);
    },
  };
}

module.exports = {
  createMcpOAuthProvider,
  startLoopbackServer,
  resolveOAuthConfig,
};

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
 * Start a loopback HTTP server bound to 127.0.0.1 on an OS-assigned port.
 * Resolves once listening with `{ server, port, codePromise }` where
 * `codePromise` resolves with the OAuth `code` (or rejects on `error`).
 */
function startLoopbackServer() {
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
    server.once("error", reject);
    // Bind to loopback only (never 0.0.0.0) — port 0 = OS-assigned.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, codePromise });
    });
  });
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

  return {
    get redirectUrl() {
      return loopback
        ? `http://127.0.0.1:${loopback.port}/callback`
        : undefined;
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
      if (!loopback) {
        loopback = await startLoopbackServer();
      }
      return loopback;
    },

    _stopLoopback() {
      if (loopback) {
        try {
          loopback.server.close();
        } catch (_e) {
          /* already closing */
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

module.exports = { createMcpOAuthProvider, startLoopbackServer };

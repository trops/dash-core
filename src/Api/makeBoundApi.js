/**
 * makeBoundApi.js
 *
 * Per-mount proxy of `window.mainApi` that auto-injects a mount
 * token on every gated call. WidgetFactory builds one of these
 * after `framework:register-widget-mount` returns a token, then
 * passes it via `WidgetContext.value.api` and as an `api` prop on
 * every widget render.
 *
 * The renderer receives a fresh proxy per mount; widgets that use
 * `props.api.data.saveData(data, file)` get gated automatically
 * without writing widgetId into their code.
 *
 * **Limit:** the proxy lives in the renderer's JS realm, same realm
 * as widgets. A malicious widget can still walk the React fiber
 * tree and call another widget's bound api function — the call
 * fires IPC with the *victim's* token. Closing that residual
 * requires per-widget BrowserView (multi-week refactor). The token
 * model raises the bar from "type a widgetId string" to "actively
 * walk fibers and call another widget's bound function," which is
 * a deliberate malicious step visible at install-time review.
 */
// Total positional-argument count for each gated method, with the
// `token` arg sitting in the final slot. The proxy pads any unused
// intermediate slots with `null` and appends the token to position
// `length - 1`. Mirrors the IPC handler signatures introduced in
// slice 1 of the widget-mount-token campaign:
//
//   data.saveData(data, filename, append, returnEmpty, widgetId, token)            // 6
//   data.readData(filename, returnEmpty, widgetId, token)                          // 4
//   data.readDataFromURL(url, toFilepath, widgetId, token)                         // 4
//   mcp.callTool(serverName, toolName, args, allowedTools, widgetId,
//                workspaceId, token)                                               // 7
//   webSocket.connect(providerName, config, widgetId, token)                       // 4
//
// Anything not in this map passes through unchanged.
const GATED_LENGTHS = {
  "data.saveData": 6,
  "data.readData": 4,
  "data.readDataFromURL": 4,
  "mcp.callTool": 7,
  "webSocket.connect": 4,
};

function _bindMethod(rawFn, signatureLength, token) {
  return (...args) => {
    const padded = [...args];
    // Pad trailing slots up to (but not including) the token slot
    // with null. This is what gives callers a "you may pass any
    // prefix of the signature, the proxy fills the rest" UX.
    while (padded.length < signatureLength - 1) padded.push(null);
    padded.push(token);
    return rawFn(...padded);
  };
}

/**
 * @param {object} rawApi - typically `window.mainApi`
 * @param {string|null} token - the mount token; null briefly before
 *                              register-mount resolves. Pass-through
 *                              when null so callers can't accidentally
 *                              freeze on a placeholder.
 * @returns {object} per-mount proxy
 */
export function makeBoundApi(rawApi, token) {
  if (!rawApi || typeof rawApi !== "object") return rawApi;
  if (!token) return rawApi;

  const out = { ...rawApi };
  // Two-pass: first collect which namespaces need cloning so we
  // don't repeatedly clobber sibling bindings within the same
  // namespace (e.g. `data.saveData` + `data.readData` both live
  // under `out.data`). Then write all rebindings.
  const nsToBindings = {};
  for (const [path, signatureLength] of Object.entries(GATED_LENGTHS)) {
    const [ns, method] = path.split(".");
    const subns = rawApi[ns];
    if (!subns || typeof subns[method] !== "function") continue;
    if (!nsToBindings[ns]) nsToBindings[ns] = { ...subns };
    nsToBindings[ns][method] = _bindMethod(
      subns[method],
      signatureLength,
      token,
    );
  }
  for (const [ns, cloned] of Object.entries(nsToBindings)) {
    out[ns] = cloned;
  }
  return out;
}

/**
 * Provider hooks must read workspace-level bindings using the same
 * widget-identity fallback chain (`uuidString || uuid || id`) that
 * the bulk-save / canonical write path uses.
 *
 * Bug repro: setting a provider for a widget via the dashboard's
 * bulk edit modal didn't persist for widgets that lack `uuidString`.
 * The save wrote `workspace.selectedProviders[<uuid>][<type>]`, but
 * the runtime hooks read by `widgetData.uuidString` only — that
 * lookup returned `selectedProviders[undefined]` → no match, so the
 * widget rendered without the freshly-set provider even though the
 * binding was saved correctly.
 *
 * Static source-presence test mirroring the NewProviderPicker
 * pattern. Asserts every read-side hook now uses the full fallback
 * chain so write/read keys can't drift again.
 */
const fs = require("fs");
const path = require("path");

const HOOKS = [
  "useMcpProvider.js",
  "useWidgetProviders.js",
  "useWebSocketProvider.js",
];

describe("Provider hooks — widget-identity fallback chain", () => {
  HOOKS.forEach((file) => {
    test(`${file} resolves widgetId via uuidString || uuid || id`, () => {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      // The widgetId derivation must include all three identity
      // forms in canonical order. Allow optional whitespace +
      // optional `widgetData?.` prefixes between fallbacks.
      expect(source).toMatch(
        /widgetData\??\.?uuidString\s*\|\|\s*widgetData\??\.?uuid\s*\|\|\s*widgetData\??\.?id/,
      );
    });
  });
});

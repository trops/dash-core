/**
 * The AI Assistant chat follows the light/dark theme: no hardcoded Tailwind
 * colors (they render dark-only, and opacity modifiers like `bg-gray-800/40`
 * aren't in the prebuilt CSS bundle). Colors come from dash-react
 * primitives, ThemeContext tokens, or useStatusTokens().
 *
 * Same rule dash-electron enforces on its sample widgets
 * (widgetConventions.test.js "Sample widget theme compliance").
 */
const fs = require("fs");
const path = require("path");

const COLOR =
  /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|divide|placeholder|from|via|to)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-(?:50|100|200|300|400|500|600|700|800|900|950))?(?:\/\d+)?\b/g;
const ARBITRARY =
  /(?<![\w-])(?:[a-z-]+:)*(?:text|bg|border|w|h|max-w|max-h)-\[[^\]]+\]/g;

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(full));
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name))
      out.push(full);
  }
  return out;
}

describe("AI Assistant chat — theme compliance", () => {
  test.each(sources(__dirname).map((f) => [path.relative(__dirname, f), f]))(
    "%s has no hardcoded color or arbitrary-value classes",
    (_name, file) => {
      const src = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(src.match(COLOR) || []).toEqual([]);
      expect(src.match(ARBITRARY) || []).toEqual([]);
    },
  );
});

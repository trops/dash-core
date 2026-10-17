/**
 * The renderer's plan check (src/utils/teamPlan.js) is a copy of the main
 * process's (electron/bots/teamPlan.js) — the Create screen disables Build on
 * the same errors the main process refuses (consolidation Phase 1b).
 */
const fs = require("fs");
const path = require("path");

const strip = (s) =>
  s
    .replace(/^\/\/ A copy of[^\n]*\n\/\/[^\n]*\n/, "")
    .replace(/^"use strict";\n+/m, "")
    .replace(/(module\.exports = |export )\{[\s\S]*$/, "")
    .trim();

test("the renderer's plan check is the main process's", () => {
  const main = fs.readFileSync(
    path.join(__dirname, "..", "..", "electron", "bots", "teamPlan.js"),
    "utf8",
  );
  const renderer = fs.readFileSync(path.join(__dirname, "teamPlan.js"), "utf8");
  expect(strip(renderer)).toBe(strip(main));
});

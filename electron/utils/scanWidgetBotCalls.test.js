/**
 * scanWidgetBotCalls.test.js — widget packages that start bots directly are
 * refused at install (team-dashboards TD-005 AC1, create-entry phase 4c).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  callsBots,
  scanWidgetBotCalls,
  assertNoBotCalls,
} = require("./scanWidgetBotCalls");

function pkg(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "botscan-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe("callsBots", () => {
  it("catches each way of reaching mainApi.bots", () => {
    assert.equal(callsBots("window.mainApi.bots.run(id)"), true);
    assert.equal(callsBots("window.mainApi?.bots?.askLead(id, q)"), true);
    assert.equal(callsBots('mainApi["bots"].run(x)'), true);
    assert.equal(callsBots("mainApi ['bots']"), true);
    assert.equal(callsBots("const { bots, widgets } = window.mainApi;"), true);
  });

  it("leaves code that only mentions bots alone", () => {
    assert.equal(callsBots("<p>Your bots run on events.</p>"), false);
    assert.equal(callsBots("window.mainApi.widgets.list()"), false);
    assert.equal(callsBots("publishEvent('checkEmail', {})"), false);
    assert.equal(callsBots("const robots = 3;"), false);
  });
});

describe("scanWidgetBotCalls", () => {
  it("finds calls in the built bundle and in source; skips node_modules", () => {
    const dir = pkg({
      "dist/index.cjs.js": "module.exports=()=>window.mainApi.bots.run('b')",
      "widgets/Go.js": "export default () => null;",
      "node_modules/x/index.js": "window.mainApi.bots.run()",
      "README.md": "mainApi.bots is off limits",
    });
    const res = scanWidgetBotCalls(dir);
    assert.equal(res.ok, false);
    assert.deepEqual(res.files, [path.join("dist", "index.cjs.js")]);
  });

  it("a clean action widget passes", () => {
    const dir = pkg({
      "widgets/CheckEmail.js":
        "export default function CheckEmail(){ const { publishEvent } = useWidgetEvents(); return null; }",
      "widgets/CheckEmail.dash.js":
        "export default { events: ['checkEmail'] };",
    });
    assert.deepEqual(scanWidgetBotCalls(dir), { ok: true, files: [] });
  });
});

describe("assertNoBotCalls", () => {
  it("throws a plain refusal and removes the package folder", () => {
    const dir = pkg({ "dist/index.cjs.js": "mainApi.bots.run()" });
    assert.throws(
      () => assertNoBotCalls("@acme/runner", dir),
      (err) =>
        err.code === "WIDGET_CALLS_BOTS" &&
        /@acme\/runner wasn't installed: it starts your bots directly/.test(
          err.message,
        ) &&
        /Run on events/.test(err.message),
    );
    assert.equal(fs.existsSync(dir), false);
  });

  it("does nothing for a clean package", () => {
    const dir = pkg({ "dist/index.cjs.js": "module.exports = 1;" });
    assertNoBotCalls("@acme/ok", dir);
    assert.equal(fs.existsSync(dir), true);
  });
});

describe("every install path runs the scan (TD-005)", () => {
  const reg = fs.readFileSync(
    path.join(__dirname, "..", "widgetRegistry.js"),
    "utf8",
  );
  // One check for every path (checkPackage, install gate — Phase 1a): the
  // scan runs on the staged package before anything is registered.
  it("checkPackage runs the scan, and every install path runs checkPackage", () => {
    assert.match(
      reg,
      /async function checkPackage\(widgetName, dir, done = "installed"\) \{[\s\S]{0,300}assertNoBotCalls\(widgetName, dir\)/,
    );
    // stageInstall (installFromLocalPath, downloadWidget) and the folder loop.
    assert.match(reg, /await checkPackage\(widgetName, staged\);/);
    assert.equal(
      (reg.match(/await stageInstall\(widgetName, widgetPath/g) || []).length,
      2,
    );
  });
  it("the folder loop skips (never deletes) a widget that fails, saying why", () => {
    assert.match(
      reg,
      /await checkPackage\(entry\.name, widgetPath, "loaded"\);/,
    );
    assert.match(reg, /refused\.push\(entry\.name\);/);
    assert.match(reg, /refusedReasons\[entry\.name\] = e\.message;/);
  });
});

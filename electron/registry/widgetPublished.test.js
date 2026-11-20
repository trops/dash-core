/**
 * widgetPublished.test.js — whether a widget changed since it was last
 * published or installed (DASH-22).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tempDir } = require("../testUtils/tempDir");
const { RECORD, changedSince, writeRecord } = require("./widgetPublished");

function makePackage() {
  const dir = tempDir("zz-published-");
  fs.mkdirSync(path.join(dir, "widgets"));
  fs.writeFileSync(path.join(dir, "widgets", "Hello.js"), "export default 1;");
  fs.writeFileSync(path.join(dir, "package.json"), '{"version":"1.0.0"}');
  return dir;
}

describe("changed since it was last published", () => {
  it("no record: can't tell", () => {
    assert.deepEqual(changedSince(makePackage()), {
      changed: null,
      basedOn: null,
    });
  });

  it("published, then untouched: unchanged", () => {
    const dir = makePackage();
    writeRecord(dir, "1.0.0");
    assert.deepEqual(changedSince(dir), { changed: false, basedOn: "1.0.0" });
  });

  it("what Dash writes itself, and builds, don't count", () => {
    const dir = makePackage();
    writeRecord(dir, "1.0.0");
    fs.writeFileSync(path.join(dir, "package.json"), '{"version":"1.0.1"}');
    fs.mkdirSync(path.join(dir, "dist"));
    fs.writeFileSync(path.join(dir, "dist", "index.cjs.js"), "built");
    assert.equal(changedSince(dir).changed, false);
  });

  it("a change to its code: changed", () => {
    const dir = makePackage();
    writeRecord(dir, "1.0.0");
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      "export default 2;",
    );
    assert.deepEqual(changedSince(dir), { changed: true, basedOn: "1.0.0" });
  });

  it("the record is a dot file, so it's never zipped into a publish", () => {
    assert.ok(RECORD.startsWith("."));
  });
});

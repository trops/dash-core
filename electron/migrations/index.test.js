/**
 * Tests for the schema-migration chain runner.
 *
 * Uses a synthetic registry so the tests don't depend on the live
 * SETTINGS_MIGRATIONS — keeps them stable as new migrations land.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { runMigrations, migrateSettings, readVersion } = require("./index");

function makeMigration(from, to, mutator = (d) => d) {
  return {
    from,
    to,
    description: `${from} → ${to}`,
    apply: mutator,
  };
}

describe("readVersion", () => {
  it("returns '0' for null / undefined / non-object", () => {
    assert.equal(readVersion(null), "0");
    assert.equal(readVersion(undefined), "0");
    assert.equal(readVersion("settings.json contents"), "0");
  });

  it("returns '0' when schemaVersion field is missing", () => {
    assert.equal(readVersion({}), "0");
    assert.equal(readVersion({ foo: "bar" }), "0");
  });

  it("returns the stamped version", () => {
    assert.equal(readVersion({ schemaVersion: "1" }), "1");
    assert.equal(readVersion({ schemaVersion: "42" }), "42");
  });

  it("treats non-string / empty schemaVersion as '0'", () => {
    assert.equal(readVersion({ schemaVersion: "" }), "0");
    assert.equal(readVersion({ schemaVersion: 1 }), "0");
    assert.equal(readVersion({ schemaVersion: null }), "0");
  });
});

describe("runMigrations — no-op cases", () => {
  it("is a no-op when target equals current", () => {
    const data = { schemaVersion: "1", a: 1 };
    const result = runMigrations(data, [makeMigration("1", "2")], "1");
    assert.equal(result.migrated, false);
    assert.deepEqual(result.appliedSteps, []);
    assert.equal(result.data.schemaVersion, "1");
    assert.equal(result.data.a, 1);
  });

  it("does not mutate the input", () => {
    const data = { schemaVersion: "0", a: 1 };
    const frozen = JSON.stringify(data);
    runMigrations(
      data,
      [makeMigration("0", "1", (d) => ({ ...d, b: 2 }))],
      "1",
    );
    assert.equal(JSON.stringify(data), frozen);
  });
});

describe("runMigrations — happy chain", () => {
  it("applies a single step", () => {
    const data = { schemaVersion: "0", a: 1 };
    const result = runMigrations(
      data,
      [makeMigration("0", "1", (d) => ({ ...d, a: d.a + 1 }))],
      "1",
    );
    assert.equal(result.migrated, true);
    assert.deepEqual(result.appliedSteps, [{ from: "0", to: "1" }]);
    assert.equal(result.data.schemaVersion, "1");
    assert.equal(result.data.a, 2);
  });

  it("walks a multi-step chain in order", () => {
    const data = { schemaVersion: "0", trail: [] };
    const migrations = [
      makeMigration("0", "1", (d) => ({
        ...d,
        trail: [...d.trail, "0->1"],
      })),
      makeMigration("1", "2", (d) => ({
        ...d,
        trail: [...d.trail, "1->2"],
      })),
      makeMigration("2", "3", (d) => ({
        ...d,
        trail: [...d.trail, "2->3"],
      })),
    ];
    const result = runMigrations(data, migrations, "3");
    assert.equal(result.migrated, true);
    assert.deepEqual(result.appliedSteps, [
      { from: "0", to: "1" },
      { from: "1", to: "2" },
      { from: "2", to: "3" },
    ]);
    assert.equal(result.data.schemaVersion, "3");
    assert.deepEqual(result.data.trail, ["0->1", "1->2", "2->3"]);
  });

  it("treats missing schemaVersion as version 0", () => {
    const data = { a: 1 };
    const result = runMigrations(
      data,
      [makeMigration("0", "1", (d) => ({ ...d, b: 2 }))],
      "1",
    );
    assert.equal(result.data.schemaVersion, "1");
    assert.equal(result.data.a, 1);
    assert.equal(result.data.b, 2);
  });
});

describe("runMigrations — error cases", () => {
  it("throws when no migration starts at the current version", () => {
    const data = { schemaVersion: "5" };
    assert.throws(
      () => runMigrations(data, [makeMigration("0", "1")], "1"),
      /Cannot migrate from schemaVersion "5"/,
    );
  });

  it("throws on a gap in the chain", () => {
    // Have 0→1 and 2→3 but no 1→2.
    const migrations = [makeMigration("0", "1"), makeMigration("2", "3")];
    assert.throws(
      () => runMigrations({ schemaVersion: "0" }, migrations, "3"),
      /Cannot migrate from schemaVersion "1"/,
    );
  });

  it("throws when an apply() returns a non-object", () => {
    const migrations = [makeMigration("0", "1", () => null)];
    assert.throws(
      () => runMigrations({}, migrations, "1"),
      /returned a non-object/,
    );
  });
});

describe("runMigrations — idempotence", () => {
  it("re-running on already-migrated data is a no-op", () => {
    const migrations = [makeMigration("0", "1", (d) => ({ ...d, b: 2 }))];
    const first = runMigrations({}, migrations, "1");
    assert.equal(first.migrated, true);
    const second = runMigrations(first.data, migrations, "1");
    assert.equal(second.migrated, false);
    assert.deepEqual(second.data, first.data);
  });
});

describe("migrateSettings (convenience wrapper)", () => {
  it("stamps schemaVersion on a legacy settings object", () => {
    const result = migrateSettings({
      userDataDirectory: "/some/path",
      theme: "dark",
    });
    assert.equal(result.migrated, true);
    assert.equal(result.data.schemaVersion, "1");
    assert.equal(result.data.userDataDirectory, "/some/path");
    assert.equal(result.data.theme, "dark");
  });

  it("is a no-op on already-versioned settings", () => {
    const result = migrateSettings({
      schemaVersion: "1",
      theme: "dark",
    });
    assert.equal(result.migrated, false);
    assert.equal(result.data.schemaVersion, "1");
  });

  it("handles empty / null input safely", () => {
    assert.equal(migrateSettings({}).data.schemaVersion, "1");
    assert.equal(migrateSettings(null).data.schemaVersion, "1");
    assert.equal(migrateSettings(undefined).data.schemaVersion, "1");
  });
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  bumpVersion,
  resolveNextVersion,
  parsePackageName,
  generateWidgetRegistryManifest,
} = require("./widgetPublishManifest");

describe("bumpVersion", () => {
  it("bumps patch", () => {
    assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  });
  it("bumps minor and resets patch", () => {
    assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  });
  it("bumps major and resets minor + patch", () => {
    assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
  });
  it("defaults to patch when type unknown", () => {
    assert.equal(bumpVersion("1.2.3", "weird"), "1.2.4");
  });
  it("returns 1.0.0 for missing input", () => {
    assert.equal(bumpVersion("", "patch"), "1.0.0");
    assert.equal(bumpVersion(null, "patch"), "1.0.0");
  });
  it("leaves non-semver alone", () => {
    assert.equal(bumpVersion("not-a-version", "patch"), "not-a-version");
  });
});

describe("resolveNextVersion", () => {
  it("uses explicit version if given", () => {
    assert.equal(resolveNextVersion("1.2.3", { version: "9.9.9" }), "9.9.9");
  });
  it("applies bump if no explicit version", () => {
    assert.equal(resolveNextVersion("1.2.3", { bump: "minor" }), "1.3.0");
  });
  it("keeps current when neither provided", () => {
    assert.equal(resolveNextVersion("1.2.3", {}), "1.2.3");
  });
});

describe("parsePackageName", () => {
  it("parses @scope/name", () => {
    assert.deepEqual(parsePackageName("@trops/pipeline"), {
      scope: "trops",
      name: "pipeline",
    });
  });
  it("parses unscoped", () => {
    assert.deepEqual(parsePackageName("standalone"), {
      scope: null,
      name: "standalone",
    });
  });
  it("handles empty", () => {
    assert.deepEqual(parsePackageName(""), { scope: null, name: "" });
    assert.deepEqual(parsePackageName(null), { scope: null, name: "" });
  });
});

describe("generateWidgetRegistryManifest", () => {
  const samplePkg = {
    name: "@trops/pipeline",
    version: "1.0.0",
    description: "Sales pipeline widgets",
    author: "John P. Giatropoulos",
  };
  const sampleWidgets = [
    {
      component: "PipelineKanban",
      name: "Pipeline Kanban",
      description: "Kanban board",
      icon: "columns",
      providers: [
        { type: "filesystem", required: false, providerClass: "mcp" },
        { type: "google-drive", required: false, providerClass: "mcp" },
      ],
    },
    {
      component: "ProspectList",
      name: "Prospect List",
      description: "List of deals",
      icon: "list",
      providers: [
        { type: "filesystem", required: false, providerClass: "mcp" },
      ],
    },
  ];

  it("sets scope/name/version from package.json", () => {
    const m = generateWidgetRegistryManifest(samplePkg, sampleWidgets, {});
    assert.equal(m.scope, "trops");
    assert.equal(m.name, "pipeline");
    assert.equal(m.version, "1.0.0");
    assert.equal(m.type, "widget");
  });

  it("version override wins", () => {
    const m = generateWidgetRegistryManifest(samplePkg, sampleWidgets, {
      version: "2.0.0",
    });
    assert.equal(m.version, "2.0.0");
  });

  it("options.scope overrides package.json scope", () => {
    const m = generateWidgetRegistryManifest(samplePkg, sampleWidgets, {
      scope: "custom",
    });
    assert.equal(m.scope, "custom");
  });

  it("visibility defaults to public", () => {
    const m = generateWidgetRegistryManifest(samplePkg, sampleWidgets, {});
    assert.equal(m.visibility, "public");
  });

  it("visibility private when explicitly set", () => {
    const m = generateWidgetRegistryManifest(samplePkg, sampleWidgets, {
      visibility: "private",
    });
    assert.equal(m.visibility, "private");
  });

  it("aggregates providers across widgets and dedupes by type+class", () => {
    const m = generateWidgetRegistryManifest(samplePkg, sampleWidgets, {});
    const keys = m.providers.map((p) => `${p.type}:${p.providerClass}`);
    assert.deepEqual(
      keys.sort(),
      ["filesystem:mcp", "google-drive:mcp"].sort(),
    );
  });

  it("widgets array carries per-component metadata", () => {
    const m = generateWidgetRegistryManifest(samplePkg, sampleWidgets, {});
    assert.equal(m.widgets.length, 2);
    assert.equal(m.widgets[0].name, "PipelineKanban");
    assert.equal(m.widgets[0].displayName, "Pipeline Kanban");
    assert.equal(m.widgets[0].icon, "columns");
  });

  it("handles packages with no widgets array", () => {
    const m = generateWidgetRegistryManifest(samplePkg, [], {});
    assert.deepEqual(m.widgets, []);
    assert.deepEqual(m.providers, []);
  });

  it("drops null/undefined entries from widget providers arrays", () => {
    // Publish-side defense: if a widget's .dash.js ships a sparse
    // providers array (trailing comma, undefined conditional), we
    // must NOT emit them into the registry manifest. Consumers used
    // to crash on `undefined.providerClass` after installing such a
    // package. The cleanup happens inside generateWidgetRegistryManifest
    // so everyone downstream only ever sees well-formed entries.
    const dirtyWidgets = [
      {
        component: "PipelineKanban",
        name: "Pipeline Kanban",
        providers: [
          { type: "google-drive", providerClass: "mcp" },
          null,
          undefined,
          { type: "filesystem", providerClass: "mcp" },
        ],
      },
    ];
    const m = generateWidgetRegistryManifest(samplePkg, dirtyWidgets, {});
    assert.equal(m.widgets.length, 1);
    assert.equal(m.widgets[0].providers.length, 2);
    assert.deepEqual(m.widgets[0].providers.map((p) => p.type).sort(), [
      "filesystem",
      "google-drive",
    ]);
    // Aggregated providers list must also be clean.
    assert.equal(
      m.providers.every((p) => p && typeof p === "object"),
      true,
    );
  });
});

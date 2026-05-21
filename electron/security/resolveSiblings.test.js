/**
 * resolveSiblings.test.js
 *
 * Pin for the helper that maps a grant-keyed widgetId
 * (e.g. "trops.google-drive.GDriveFilePreview") to the package owning
 * it and the full list of dotted ids for every currently-installed
 * widget in that package — the inputs the JIT modal needs to offer
 * "Apply to all widgets from <package>".
 *
 * Pure helper over a registry snapshot so the test can supply fixtures
 * without touching disk.
 *
 * Run via `node --test electron/security/resolveSiblings.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { resolveSiblings } = require("./resolveSiblings");

// Fixture mirrors the shape of `getWidgetRegistry().widgets` (a Map
// keyed by packageId) — the helper accepts either a Map or a plain
// object so callers can stub easily.
function makeRegistry(entries) {
  return new Map(entries);
}

const FIXTURE_TROPS_GDRIVE = [
  "@trops/google-drive",
  {
    packageId: "@trops/google-drive",
    componentNames: [
      "GoogleDriveWidget",
      "GDriveFileList",
      "GDriveFilePreview",
      "GDriveFileSearch",
    ],
  },
];

const FIXTURE_AI_PIPELINE = [
  "@ai-built/pipeline",
  {
    packageId: "@ai-built/pipeline",
    componentNames: ["PipelineKanban", "PipelineSummary", "ProspectWorkspace"],
  },
];

const FIXTURE_SOLO_AI = [
  "@ai-built/calculatorwidget",
  {
    packageId: "@ai-built/calculatorwidget",
    componentNames: ["CalculatorWidget"],
  },
];

test("multi-widget package returns full sibling list with packageId", () => {
  const reg = makeRegistry([FIXTURE_TROPS_GDRIVE]);
  const out = resolveSiblings("trops.google-drive.GDriveFilePreview", reg);
  assert.strictEqual(out.packageId, "@trops/google-drive");
  assert.deepStrictEqual(out.siblingWidgetIds, [
    "trops.google-drive.GoogleDriveWidget",
    "trops.google-drive.GDriveFileList",
    "trops.google-drive.GDriveFilePreview",
    "trops.google-drive.GDriveFileSearch",
  ]);
});

test("single-widget package returns just the one (still includes self)", () => {
  const reg = makeRegistry([FIXTURE_SOLO_AI]);
  const out = resolveSiblings(
    "ai-built.calculatorwidget.CalculatorWidget",
    reg,
  );
  assert.strictEqual(out.packageId, "@ai-built/calculatorwidget");
  assert.deepStrictEqual(out.siblingWidgetIds, [
    "ai-built.calculatorwidget.CalculatorWidget",
  ]);
});

test("ai-built multi-widget package handles its dotted ids correctly", () => {
  const reg = makeRegistry([FIXTURE_AI_PIPELINE]);
  const out = resolveSiblings("ai-built.pipeline.PipelineSummary", reg);
  assert.strictEqual(out.packageId, "@ai-built/pipeline");
  assert.deepStrictEqual(out.siblingWidgetIds, [
    "ai-built.pipeline.PipelineKanban",
    "ai-built.pipeline.PipelineSummary",
    "ai-built.pipeline.ProspectWorkspace",
  ]);
});

test("widget not found in registry → fallback (packageId null, self only)", () => {
  const reg = makeRegistry([FIXTURE_TROPS_GDRIVE]);
  const out = resolveSiblings("@test/jit-probe", reg);
  assert.strictEqual(out.packageId, null);
  assert.deepStrictEqual(out.siblingWidgetIds, ["@test/jit-probe"]);
});

test("empty registry → fallback", () => {
  const reg = makeRegistry([]);
  const out = resolveSiblings("trops.google-drive.GDriveFileList", reg);
  assert.strictEqual(out.packageId, null);
  assert.deepStrictEqual(out.siblingWidgetIds, [
    "trops.google-drive.GDriveFileList",
  ]);
});

test("plain object registry (not Map) is also accepted", () => {
  // Some callers may have an object snapshot instead of a Map; helper
  // should accept either to make stubbing easy.
  const reg = {
    "@trops/google-drive": FIXTURE_TROPS_GDRIVE[1],
  };
  const out = resolveSiblings("trops.google-drive.GDriveFilePreview", reg);
  assert.strictEqual(out.packageId, "@trops/google-drive");
  assert.strictEqual(out.siblingWidgetIds.length, 4);
});

test("malformed registry entry is gracefully ignored", () => {
  const reg = makeRegistry([
    ["@trops/broken", { packageId: "@trops/broken" /* no componentNames */ }],
    FIXTURE_TROPS_GDRIVE,
  ]);
  const out = resolveSiblings("trops.google-drive.GDriveFileList", reg);
  // The broken entry must not throw; the good entry still resolves.
  assert.strictEqual(out.packageId, "@trops/google-drive");
  assert.strictEqual(out.siblingWidgetIds.length, 4);
});

test("non-string widgetId returns fallback (defensive)", () => {
  const reg = makeRegistry([FIXTURE_TROPS_GDRIVE]);
  assert.deepStrictEqual(resolveSiblings(null, reg), {
    packageId: null,
    siblingWidgetIds: [],
  });
  assert.deepStrictEqual(resolveSiblings(undefined, reg), {
    packageId: null,
    siblingWidgetIds: [],
  });
  assert.deepStrictEqual(resolveSiblings(123, reg), {
    packageId: null,
    siblingWidgetIds: [],
  });
});

test("widget name is extracted as the last dot-segment", () => {
  // The bare-name extraction must take the LAST `.` segment to handle
  // scope+package+component (3-part) ids correctly. A 2-segment id
  // (e.g. legacy "pkg.Widget") still extracts the trailing component.
  const reg = makeRegistry([FIXTURE_AI_PIPELINE]);
  const out = resolveSiblings("ai-built.pipeline.PipelineKanban", reg);
  assert.strictEqual(out.packageId, "@ai-built/pipeline");
});

// ─── bare-name collision: scoped resolution must NOT cross packages ───

test("scoped widgetId never matches another package with the same bare name", () => {
  // Regression guard for the JIT-consent bug where two packages
  // shipped a `GoogleDriveRecentFiles` widget (the published
  // @trops/google-drive package + an @ai-built/prompt-validation
  // test fixture). The pre-fix resolver did a bare-name scan and
  // returned the FIRST match — which meant a consent prompt for the
  // ai-built widget would offer to "apply to all 4 widgets in
  // @trops/google-drive", and approving would persist the grant
  // against widgets the user didn't even have on the dashboard.
  //
  // The scoped-first lookup pins the package from the widgetId's own
  // first two dot-segments, so a collision between two packages on
  // a bare component name can no longer steer the sibling set.
  const COLLIDING_PUBLISHED = [
    "@trops/google-drive",
    {
      packageId: "@trops/google-drive",
      componentNames: [
        "GoogleDriveWidget",
        "GDriveFileList",
        "GoogleDriveRecentFiles",
      ],
    },
  ];
  const COLLIDING_FIXTURE = [
    "@ai-built/prompt-validation",
    {
      packageId: "@ai-built/prompt-validation",
      componentNames: ["GoogleDriveRecentFiles", "Counter", "Notepad"],
    },
  ];
  // Order matters for the regression — the OLD code returned the
  // first-iterated match. Put the published package first so the
  // bare-name fallback would have grabbed it.
  const reg = makeRegistry([COLLIDING_PUBLISHED, COLLIDING_FIXTURE]);

  const out = resolveSiblings(
    "ai-built.prompt-validation.GoogleDriveRecentFiles",
    reg,
  );
  assert.strictEqual(out.packageId, "@ai-built/prompt-validation");
  assert.deepStrictEqual(out.siblingWidgetIds, [
    "ai-built.prompt-validation.GoogleDriveRecentFiles",
    "ai-built.prompt-validation.Counter",
    "ai-built.prompt-validation.Notepad",
  ]);

  // The mirror check — looking up the published-package widget id
  // still resolves to the published package's sibling set, not the
  // fixture package.
  const outOther = resolveSiblings(
    "trops.google-drive.GoogleDriveRecentFiles",
    reg,
  );
  assert.strictEqual(outOther.packageId, "@trops/google-drive");
  assert.deepStrictEqual(outOther.siblingWidgetIds, [
    "trops.google-drive.GoogleDriveWidget",
    "trops.google-drive.GDriveFileList",
    "trops.google-drive.GoogleDriveRecentFiles",
  ]);
});

test("scoped widgetId for an UNINSTALLED package returns self-only (no bare-name fallback)", () => {
  // If the scoped widgetId names a package the registry doesn't know
  // about, we MUST return self-only — not fall through to bare-name
  // search and accidentally hit another package's widget with the
  // same trailing name. Without this guard the original bug returns
  // the moment a user uninstalls the fixture package while a grant
  // request is in flight.
  const reg = makeRegistry([FIXTURE_TROPS_GDRIVE]);
  const out = resolveSiblings(
    "ai-built.prompt-validation.GoogleDriveRecentFiles",
    reg,
  );
  assert.strictEqual(out.packageId, null);
  assert.deepStrictEqual(out.siblingWidgetIds, [
    "ai-built.prompt-validation.GoogleDriveRecentFiles",
  ]);
});

test("legacy bare-name widgetId still uses fallback path (no scope present)", () => {
  // Confirms backwards-compat: a widgetId that doesn't carry scope
  // still hits the bare-name search loop. The fixture exposes a
  // single matching package so the result is unambiguous.
  const reg = makeRegistry([FIXTURE_TROPS_GDRIVE]);
  const out = resolveSiblings("GDriveFileList", reg);
  assert.strictEqual(out.packageId, "@trops/google-drive");
  // Sibling list comes from the matched package's componentNames.
  assert.strictEqual(out.siblingWidgetIds.length, 4);
});

/**
 * normalizeGrantsByProviderType.test.js
 *
 * Pin for the renderer-side helper that re-keys `granted.servers` from
 * provider INSTANCE LABELS (e.g. "Gmail New", "Filesystem") to provider
 * TYPES (e.g. "gmail", "filesystem"). Without this, declared (manifest)
 * blocks — keyed by type, since the scanner extracts the literal type
 * from `useMcpProvider("gmail")` — never join with granted blocks
 * keyed by user-set instance labels, and Settings → Privacy paints
 * every grant amber-stale.
 *
 * The runtime grant gate uses labels (the user authorizes a SPECIFIC
 * provider instance, not a type), so this normalization is purely a
 * read-side concern for declared-vs-granted comparison.
 */
"use strict";

import { normalizeGrantsByProviderType } from "./normalizeGrantsByProviderType";

describe("normalizeGrantsByProviderType", () => {
  test("re-keys label → type when label has a known provider entry", () => {
    const rows = [
      {
        widgetId: "trops.gmail.GmailCompose",
        granted: {
          servers: {
            "Gmail New": {
              tools: ["search_emails", "read_email"],
              readPaths: [],
              writePaths: [],
            },
          },
        },
      },
    ];
    const providers = {
      "Gmail New": { name: "Gmail New", type: "gmail" },
    };
    const out = normalizeGrantsByProviderType(rows, providers);
    expect(Object.keys(out[0].granted.servers)).toEqual(["gmail"]);
    expect(out[0].granted.servers.gmail.tools.sort()).toEqual([
      "read_email",
      "search_emails",
    ]);
  });

  test("filesystem case: 'Filesystem' label maps to 'filesystem' type", () => {
    const rows = [
      {
        widgetId: "trops.filesystem.FilesystemWidget",
        granted: {
          servers: {
            Filesystem: {
              tools: ["list_directory", "read_file"],
              readPaths: ["/Users/johngiatropoulos"],
              writePaths: [],
            },
          },
        },
      },
    ];
    const providers = {
      Filesystem: { name: "Filesystem", type: "filesystem" },
    };
    const out = normalizeGrantsByProviderType(rows, providers);
    expect(Object.keys(out[0].granted.servers)).toEqual(["filesystem"]);
    expect(out[0].granted.servers.filesystem.readPaths).toEqual([
      "/Users/johngiatropoulos",
    ]);
  });

  test("collision: two instances of same type union tools/readPaths/writePaths", () => {
    const rows = [
      {
        widgetId: "trops.filesystem.W",
        granted: {
          servers: {
            Filesystem: {
              tools: ["read_file"],
              readPaths: ["/a"],
              writePaths: [],
            },
            Filesystem_pipeline: {
              tools: ["list_directory", "read_file"],
              readPaths: ["/b"],
              writePaths: ["/c"],
            },
          },
        },
      },
    ];
    const providers = {
      Filesystem: { name: "Filesystem", type: "filesystem" },
      Filesystem_pipeline: {
        name: "Filesystem_pipeline",
        type: "filesystem",
      },
    };
    const out = normalizeGrantsByProviderType(rows, providers);
    expect(Object.keys(out[0].granted.servers)).toEqual(["filesystem"]);
    expect(out[0].granted.servers.filesystem.tools.sort()).toEqual([
      "list_directory",
      "read_file",
    ]);
    expect(out[0].granted.servers.filesystem.readPaths.sort()).toEqual([
      "/a",
      "/b",
    ]);
    expect(out[0].granted.servers.filesystem.writePaths).toEqual(["/c"]);
  });

  test("preserves servers whose label has no matching provider entry", () => {
    // Could be a stale grant (instance was deleted) or a legacy grant
    // recorded under a non-label key. Don't drop it — surface as-is so
    // the user can revoke it.
    const rows = [
      {
        widgetId: "trops.x.W",
        granted: {
          servers: {
            "Stale Server": { tools: ["t"], readPaths: [], writePaths: [] },
          },
        },
      },
    ];
    const providers = {};
    const out = normalizeGrantsByProviderType(rows, providers);
    expect(out[0].granted.servers["Stale Server"]).toBeDefined();
  });

  test("rows without granted.servers pass through untouched", () => {
    const rows = [
      { widgetId: "a", declared: { servers: {} }, granted: null },
      {
        widgetId: "b",
        declared: null,
        granted: { domains: { fs: { readPaths: ["/x"], writePaths: [] } } },
      },
    ];
    const out = normalizeGrantsByProviderType(rows, {});
    expect(out[0].granted).toBeNull();
    expect(out[1].granted.domains.fs.readPaths).toEqual(["/x"]);
  });

  test("declared block is unchanged (only granted is rewritten)", () => {
    const rows = [
      {
        widgetId: "trops.gmail.GmailCompose",
        declared: {
          servers: {
            gmail: { tools: ["read_email"], readPaths: [], writePaths: [] },
          },
        },
        granted: {
          servers: {
            "Gmail New": {
              tools: ["read_email"],
              readPaths: [],
              writePaths: [],
            },
          },
        },
      },
    ];
    const providers = { "Gmail New": { name: "Gmail New", type: "gmail" } };
    const out = normalizeGrantsByProviderType(rows, providers);
    expect(Object.keys(out[0].declared.servers)).toEqual(["gmail"]);
    expect(Object.keys(out[0].granted.servers)).toEqual(["gmail"]);
  });

  test("multiple rows are normalized independently", () => {
    const rows = [
      {
        widgetId: "a",
        granted: {
          servers: { "Gmail New": { tools: ["read_email"] } },
        },
      },
      {
        widgetId: "b",
        granted: {
          servers: { Filesystem: { tools: ["read_file"] } },
        },
      },
    ];
    const providers = {
      "Gmail New": { name: "Gmail New", type: "gmail" },
      Filesystem: { name: "Filesystem", type: "filesystem" },
    };
    const out = normalizeGrantsByProviderType(rows, providers);
    expect(Object.keys(out[0].granted.servers)).toEqual(["gmail"]);
    expect(Object.keys(out[1].granted.servers)).toEqual(["filesystem"]);
  });

  test("bad input: null/undefined rows or providers handled gracefully", () => {
    expect(normalizeGrantsByProviderType(null, {})).toEqual([]);
    expect(normalizeGrantsByProviderType(undefined, {})).toEqual([]);
    expect(normalizeGrantsByProviderType([], null)).toEqual([]);
    const rows = [
      {
        widgetId: "a",
        granted: { servers: { Gmail: { tools: ["t"] } } },
      },
    ];
    // null providers map should not crash; rows pass through unchanged
    const out = normalizeGrantsByProviderType(rows, null);
    expect(out[0].granted.servers.Gmail).toBeDefined();
  });

  test("attaches _labels with original instance names when translation happened", () => {
    const rows = [
      {
        widgetId: "trops.filesystem.W",
        granted: {
          servers: {
            Filesystem: { tools: ["read_file"], readPaths: [], writePaths: [] },
            Filesystem_pipeline: {
              tools: ["list_directory"],
              readPaths: [],
              writePaths: [],
            },
          },
        },
      },
    ];
    const providers = {
      Filesystem: { name: "Filesystem", type: "filesystem" },
      Filesystem_pipeline: { name: "Filesystem_pipeline", type: "filesystem" },
    };
    const out = normalizeGrantsByProviderType(rows, providers);
    expect(out[0].granted.servers.filesystem._labels.sort()).toEqual([
      "Filesystem",
      "Filesystem_pipeline",
    ]);
  });

  test("when no labels in a row translate, the row passes through unchanged (no _labels added)", () => {
    const rows = [
      {
        widgetId: "trops.x.W",
        granted: {
          servers: {
            "Stale Server": { tools: ["t"], readPaths: [], writePaths: [] },
          },
        },
      },
    ];
    const out = normalizeGrantsByProviderType(rows, {});
    // Server key untouched; no spurious _labels field injected.
    expect(out[0].granted.servers["Stale Server"]).toEqual({
      tools: ["t"],
      readPaths: [],
      writePaths: [],
    });
  });

  test("does not mutate input rows or providers", () => {
    const rows = [
      {
        widgetId: "trops.gmail.X",
        granted: {
          servers: { "Gmail New": { tools: ["t"] } },
        },
      },
    ];
    const providers = { "Gmail New": { name: "Gmail New", type: "gmail" } };
    const rowsBefore = JSON.parse(JSON.stringify(rows));
    const providersBefore = JSON.parse(JSON.stringify(providers));
    normalizeGrantsByProviderType(rows, providers);
    expect(rows).toEqual(rowsBefore);
    expect(providers).toEqual(providersBefore);
  });
});

/**
 * mcpScopeResolver.test.js
 *
 * Pins the Slice-3b path-scope union + credential-override helpers. The
 * MCP server's OS-level capability is configured at spawn time from the
 * union of widget grants on the active workspace. If these tests stop
 * passing, server processes can spawn with broader scope than the user
 * actually granted.
 *
 * Run: `node --test electron/utils/mcpScopeResolver.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  unionPathScope,
  applyPathScopeToCredentials,
} = require("./mcpScopeResolver");

test("unionPathScope: empty grants array → empty scope", () => {
  const scope = unionPathScope([], "filesystem");
  assert.deepStrictEqual(scope, {
    readPaths: [],
    writePaths: [],
    allowedPaths: [],
  });
});

test("unionPathScope: single widget with read+write paths", () => {
  const grants = [
    {
      widgetId: "@trops/notes",
      granted: {
        servers: {
          filesystem: {
            tools: ["read_file"],
            readPaths: ["/Users/jane/notes"],
            writePaths: ["/tmp"],
          },
        },
      },
    },
  ];
  const scope = unionPathScope(grants, "filesystem");
  assert.deepStrictEqual(scope.readPaths, ["/Users/jane/notes"]);
  assert.deepStrictEqual(scope.writePaths, ["/tmp"]);
  assert.deepStrictEqual(scope.allowedPaths.sort(), [
    "/Users/jane/notes",
    "/tmp",
  ]);
});

test("Slice 3b: unionPathScope merges grants from multiple widgets on same server", () => {
  const grants = [
    {
      widgetId: "@trops/notes",
      granted: {
        servers: {
          filesystem: {
            tools: ["read_file"],
            readPaths: ["/Users/jane/notes"],
            writePaths: [],
          },
        },
      },
    },
    {
      widgetId: "@trops/code-search",
      granted: {
        servers: {
          filesystem: {
            tools: ["read_file"],
            readPaths: ["/Users/jane/code"],
            writePaths: ["/tmp"],
          },
        },
      },
    },
  ];
  const scope = unionPathScope(grants, "filesystem");
  assert.deepStrictEqual(scope.allowedPaths.sort(), [
    "/Users/jane/code",
    "/Users/jane/notes",
    "/tmp",
  ]);
});

test("unionPathScope: deduplicates paths shared between widgets", () => {
  const grants = [
    {
      widgetId: "@trops/a",
      granted: {
        servers: {
          filesystem: { readPaths: ["/x"], writePaths: ["/y"] },
        },
      },
    },
    {
      widgetId: "@trops/b",
      granted: {
        servers: {
          filesystem: { readPaths: ["/x", "/z"], writePaths: [] },
        },
      },
    },
  ];
  const scope = unionPathScope(grants, "filesystem");
  assert.deepStrictEqual(scope.readPaths.sort(), ["/x", "/z"]);
  assert.deepStrictEqual(scope.writePaths, ["/y"]);
  assert.deepStrictEqual(scope.allowedPaths.sort(), ["/x", "/y", "/z"]);
});

test("unionPathScope: ignores grants for other server names", () => {
  const grants = [
    {
      widgetId: "@trops/a",
      granted: {
        servers: {
          filesystem: { readPaths: ["/fs"] },
          github: { readPaths: ["irrelevant"] },
        },
      },
    },
  ];
  const scope = unionPathScope(grants, "filesystem");
  assert.deepStrictEqual(scope.readPaths, ["/fs"]);
});

test("unionPathScope: skips grants without the target server entry", () => {
  const grants = [
    {
      widgetId: "@trops/no-fs",
      granted: { servers: { github: { tools: ["x"] } } },
    },
    {
      widgetId: "@trops/has-fs",
      granted: { servers: { filesystem: { readPaths: ["/x"] } } },
    },
  ];
  const scope = unionPathScope(grants, "filesystem");
  assert.deepStrictEqual(scope.readPaths, ["/x"]);
});

test("unionPathScope: malformed grants don't throw", () => {
  const grants = [
    null,
    { widgetId: null, granted: null },
    { widgetId: "@trops/a", granted: { servers: null } },
    { widgetId: "@trops/b" }, // missing granted
  ];
  const scope = unionPathScope(grants, "filesystem");
  assert.deepStrictEqual(scope, {
    readPaths: [],
    writePaths: [],
    allowedPaths: [],
  });
});

test("applyPathScopeToCredentials: overrides allowedPaths from scope", () => {
  const credentials = { allowedPaths: "/old/path", apiKey: "secret" };
  const scope = {
    readPaths: ["/granted/a"],
    writePaths: ["/granted/b"],
    allowedPaths: ["/granted/a", "/granted/b"],
  };
  const result = applyPathScopeToCredentials(credentials, scope);
  // allowedPaths gets the union (joined as comma-separated to match
  // existing argsMapping.split convention)
  assert.strictEqual(result.allowedPaths, "/granted/a,/granted/b");
  // Other credential keys are preserved
  assert.strictEqual(result.apiKey, "secret");
});

test("applyPathScopeToCredentials: empty scope leaves credentials untouched", () => {
  const credentials = { allowedPaths: "/old/path" };
  const scope = { readPaths: [], writePaths: [], allowedPaths: [] };
  const result = applyPathScopeToCredentials(credentials, scope);
  assert.strictEqual(result.allowedPaths, "/old/path");
});

test("applyPathScopeToCredentials: null credentials returns scope-only object", () => {
  const scope = {
    readPaths: ["/a"],
    writePaths: [],
    allowedPaths: ["/a"],
  };
  const result = applyPathScopeToCredentials(null, scope);
  assert.strictEqual(result.allowedPaths, "/a");
});

test("applyPathScopeToCredentials: returns a new object — does not mutate input", () => {
  const credentials = { allowedPaths: "/old", apiKey: "secret" };
  const scope = {
    readPaths: ["/new"],
    writePaths: [],
    allowedPaths: ["/new"],
  };
  applyPathScopeToCredentials(credentials, scope);
  assert.strictEqual(credentials.allowedPaths, "/old");
});

/**
 * applyPathRemoval.test.js
 *
 * Pin for the helper that removes a single read/write path from a
 * server's grant block. Used by the per-path trash-can in the
 * Privacy & Security panel — lets the user prune one entry without
 * revoking every path on the server.
 *
 * Like applyToolToggle, this helper handles label fan-out (paths can
 * exist on multiple provider instances) and returns null when the
 * grant becomes structurally empty so the caller knows to revoke
 * the whole grant rather than write an empty one.
 */
"use strict";

import { applyPathRemoval } from "./applyPathRemoval";

describe("applyPathRemoval", () => {
  test("removes a single read path from one label", () => {
    const grant = {
      servers: {
        Filesystem: {
          tools: ["read_file"],
          readPaths: ["/a", "/b"],
          writePaths: [],
        },
      },
    };
    const out = applyPathRemoval(grant, ["Filesystem"], "readPaths", "/a");
    expect(out.servers.Filesystem.readPaths).toEqual(["/b"]);
    // Tools preserved.
    expect(out.servers.Filesystem.tools).toEqual(["read_file"]);
  });

  test("removes a single write path from one label", () => {
    const grant = {
      servers: {
        Filesystem: {
          tools: [],
          readPaths: [],
          writePaths: ["/x", "/y"],
        },
      },
    };
    const out = applyPathRemoval(grant, ["Filesystem"], "writePaths", "/x");
    expect(out.servers.Filesystem.writePaths).toEqual(["/y"]);
  });

  test("fans out across multiple labels of same type", () => {
    const grant = {
      servers: {
        Filesystem: {
          tools: [],
          readPaths: ["/a", "/shared"],
          writePaths: [],
        },
        Filesystem_pipeline: {
          tools: [],
          readPaths: ["/b", "/shared"],
          writePaths: [],
        },
      },
    };
    const out = applyPathRemoval(
      grant,
      ["Filesystem", "Filesystem_pipeline"],
      "readPaths",
      "/shared",
    );
    expect(out.servers.Filesystem.readPaths).toEqual(["/a"]);
    expect(out.servers.Filesystem_pipeline.readPaths).toEqual(["/b"]);
  });

  test("removing a path that isn't there is a safe no-op", () => {
    const grant = {
      servers: {
        Filesystem: { tools: ["read_file"], readPaths: ["/a"], writePaths: [] },
      },
    };
    const out = applyPathRemoval(
      grant,
      ["Filesystem"],
      "readPaths",
      "/notthere",
    );
    expect(out.servers.Filesystem.readPaths).toEqual(["/a"]);
  });

  test("server entry pruned when all tools and paths gone", () => {
    const grant = {
      servers: {
        Filesystem: { tools: [], readPaths: ["/a"], writePaths: [] },
        Other: { tools: ["t"], readPaths: [], writePaths: [] },
      },
    };
    const out = applyPathRemoval(grant, ["Filesystem"], "readPaths", "/a");
    expect(out.servers.Filesystem).toBeUndefined();
    expect(out.servers.Other).toBeDefined();
  });

  test("returns null when all servers empty AND no domains", () => {
    const grant = {
      servers: {
        Filesystem: { tools: [], readPaths: ["/a"], writePaths: [] },
      },
    };
    const out = applyPathRemoval(grant, ["Filesystem"], "readPaths", "/a");
    expect(out).toBeNull();
  });

  test("does not mutate the input grant", () => {
    const grant = {
      servers: {
        Filesystem: { tools: ["read_file"], readPaths: ["/a"], writePaths: [] },
      },
    };
    const before = JSON.parse(JSON.stringify(grant));
    applyPathRemoval(grant, ["Filesystem"], "readPaths", "/a");
    expect(grant).toEqual(before);
  });

  test("invalid kind is rejected (returns input unchanged conceptually)", () => {
    const grant = {
      servers: {
        Filesystem: { tools: [], readPaths: ["/a"], writePaths: [] },
      },
    };
    const out = applyPathRemoval(grant, ["Filesystem"], "garbage", "/a");
    // Returns unchanged copy so renderer can still call setGrant safely.
    expect(out.servers.Filesystem.readPaths).toEqual(["/a"]);
  });

  test("bad input handled gracefully", () => {
    expect(applyPathRemoval(null, ["X"], "readPaths", "/a")).toBeNull();
    expect(applyPathRemoval({}, [], "readPaths", "/a")).toBeNull();
    expect(
      applyPathRemoval({ servers: {} }, ["X"], "readPaths", ""),
    ).toBeNull();
  });
});

/**
 * applyToolToggle.test.js
 *
 * Pin for the pure helper that produces an updated grant object after
 * the user toggles a tool on/off in the Privacy & Security panel.
 *
 * The helper handles the LABEL fan-out for type-keyed display: if the
 * user toggles "read_file" off on the type "filesystem" and that type
 * has two configured instances ("Filesystem", "Filesystem_pipeline"),
 * the tool is removed from BOTH instances' tools arrays so the runtime
 * gate can't satisfy the grant via either instance.
 *
 * Returns null when the grant becomes empty (no servers with any
 * tools/paths AND no domains) — the caller should treat that as a
 * full revoke.
 */
"use strict";

import { applyToolToggle } from "./applyToolToggle";

describe("applyToolToggle", () => {
  test("toggle OFF removes tool from a single instance label", () => {
    const grant = {
      servers: {
        "Gmail New": {
          tools: ["search_emails", "read_email", "send_email"],
          readPaths: [],
          writePaths: [],
        },
      },
      grantOrigin: "live",
    };
    const out = applyToolToggle(grant, ["Gmail New"], "send_email", false);
    expect(out.servers["Gmail New"].tools.sort()).toEqual([
      "read_email",
      "search_emails",
    ]);
    // Other fields preserved.
    expect(out.grantOrigin).toBe("live");
  });

  test("toggle OFF fans out across multiple labels of same type", () => {
    const grant = {
      servers: {
        Filesystem: {
          tools: ["read_file", "list_directory"],
          readPaths: [],
          writePaths: [],
        },
        Filesystem_pipeline: {
          tools: ["read_file", "search_files"],
          readPaths: [],
          writePaths: [],
        },
      },
    };
    const out = applyToolToggle(
      grant,
      ["Filesystem", "Filesystem_pipeline"],
      "read_file",
      false,
    );
    expect(out.servers.Filesystem.tools).toEqual(["list_directory"]);
    expect(out.servers.Filesystem_pipeline.tools).toEqual(["search_files"]);
  });

  test("toggle ON adds tool when not present", () => {
    const grant = {
      servers: {
        "Gmail New": {
          tools: ["search_emails"],
          readPaths: [],
          writePaths: [],
        },
      },
    };
    const out = applyToolToggle(grant, ["Gmail New"], "send_email", true);
    expect(out.servers["Gmail New"].tools.sort()).toEqual([
      "search_emails",
      "send_email",
    ]);
  });

  test("toggle ON is idempotent (already present)", () => {
    const grant = {
      servers: {
        "Gmail New": {
          tools: ["search_emails"],
          readPaths: [],
          writePaths: [],
        },
      },
    };
    const out = applyToolToggle(grant, ["Gmail New"], "search_emails", true);
    expect(out.servers["Gmail New"].tools).toEqual(["search_emails"]);
  });

  test("toggle OFF on a tool that isn't there is a no-op (still returns updated shape)", () => {
    const grant = {
      servers: {
        "Gmail New": {
          tools: ["search_emails"],
          readPaths: [],
          writePaths: [],
        },
      },
    };
    const out = applyToolToggle(grant, ["Gmail New"], "send_email", false);
    expect(out.servers["Gmail New"].tools).toEqual(["search_emails"]);
  });

  test("server entry is removed when its tools+paths all become empty (other server present)", () => {
    const grant = {
      servers: {
        "Gmail New": { tools: ["send_email"], readPaths: [], writePaths: [] },
        Slack: { tools: ["send_message"], readPaths: [], writePaths: [] },
      },
    };
    const out = applyToolToggle(grant, ["Gmail New"], "send_email", false);
    expect(out.servers["Gmail New"]).toBeUndefined();
    expect(out.servers.Slack).toBeDefined();
  });

  test("server entry kept when tools empty but paths still present", () => {
    const grant = {
      servers: {
        Filesystem: {
          tools: ["read_file"],
          readPaths: ["/Users/john"],
          writePaths: [],
        },
      },
    };
    const out = applyToolToggle(grant, ["Filesystem"], "read_file", false);
    expect(out.servers.Filesystem).toBeDefined();
    expect(out.servers.Filesystem.tools).toEqual([]);
    expect(out.servers.Filesystem.readPaths).toEqual(["/Users/john"]);
  });

  test("returns null when ALL servers become empty AND no domains", () => {
    const grant = {
      servers: {
        "Gmail New": { tools: ["send_email"], readPaths: [], writePaths: [] },
      },
    };
    const out = applyToolToggle(grant, ["Gmail New"], "send_email", false);
    expect(out).toBeNull();
  });

  test("returns non-null when ALL servers empty but domains still present", () => {
    const grant = {
      servers: {
        "Gmail New": { tools: ["send_email"], readPaths: [], writePaths: [] },
      },
      domains: { fs: { readPaths: ["/x"], writePaths: [] } },
    };
    const out = applyToolToggle(grant, ["Gmail New"], "send_email", false);
    expect(out).not.toBeNull();
    expect(out.servers["Gmail New"]).toBeUndefined();
    expect(out.domains.fs.readPaths).toEqual(["/x"]);
  });

  test("toggle ON for label not present in grant creates the server entry", () => {
    const grant = { servers: {} };
    const out = applyToolToggle(grant, ["Gmail New"], "send_email", true);
    expect(out.servers["Gmail New"]).toEqual({
      tools: ["send_email"],
      readPaths: [],
      writePaths: [],
    });
  });

  test("does not mutate the input grant", () => {
    const grant = {
      servers: {
        "Gmail New": {
          tools: ["a", "b"],
          readPaths: [],
          writePaths: [],
        },
      },
    };
    const before = JSON.parse(JSON.stringify(grant));
    applyToolToggle(grant, ["Gmail New"], "a", false);
    expect(grant).toEqual(before);
  });

  test("bad input handled gracefully", () => {
    expect(applyToolToggle(null, ["X"], "t", false)).toBeNull();
    expect(applyToolToggle({}, ["X"], "t", false)).toBeNull();
    expect(applyToolToggle({ servers: {} }, [], "t", false)).toBeNull();
  });
});

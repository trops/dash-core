/**
 * rememberGrant.test.js — turning an "Always allow" approval into a durable,
 * narrowly-scoped bot grant (and revoking it).
 *
 * A remembered approval is scoped to: this bot + this provider + this tool,
 * plus — for tools that take a file path — the folder of the approved path
 * (read vs write access by tool kind). Nothing broader.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  rememberToolGrant,
  forgetToolGrant,
  summarizeGrants,
  folderForPathArg,
} = require("./rememberGrant");

// Same rules the real gate uses (electron/mcp/permissionGate.js).
const helpers = {
  isWriteTool: (t) =>
    /(^|_)(write|create|edit|delete|remove|append|move|rename|chmod|chown|mkdir)/i.test(
      t,
    ),
  pathArgKeys: ["path", "uri", "filepath", "file", "directory"],
  dirname: path.dirname,
};

describe("rememberToolGrant", () => {
  it("adds the tool for that provider on a bot with no grant yet", () => {
    const perms = rememberToolGrant(
      null,
      { serverName: "Gmail New", toolName: "search_emails", args: { q: "x" } },
      helpers,
    );
    assert.equal(perms.grantOrigin, "manual");
    assert.deepEqual(perms.servers["Gmail New"], {
      tools: ["search_emails"],
      readPaths: [],
      writePaths: [],
    });
  });

  it("merges into an existing grant without duplicates or touching other providers", () => {
    const existing = {
      grantOrigin: "manual",
      servers: {
        Slack: { tools: ["list_channels"], readPaths: [], writePaths: [] },
        "Gmail New": { tools: ["read_email"], readPaths: [], writePaths: [] },
      },
    };
    const once = rememberToolGrant(
      existing,
      { serverName: "Gmail New", toolName: "search_emails", args: {} },
      helpers,
    );
    const twice = rememberToolGrant(
      once,
      { serverName: "Gmail New", toolName: "search_emails", args: {} },
      helpers,
    );
    assert.deepEqual(twice.servers["Gmail New"].tools, [
      "read_email",
      "search_emails",
    ]);
    assert.deepEqual(twice.servers.Slack, existing.servers.Slack);
    // Input not mutated.
    assert.deepEqual(existing.servers["Gmail New"].tools, ["read_email"]);
  });

  it("read tool with a file path remembers the file's folder as a READ path", () => {
    const perms = rememberToolGrant(
      null,
      {
        serverName: "Filesystem",
        toolName: "read_text_file",
        args: { path: "/Users/me/Development/notes/todo.txt" },
      },
      helpers,
    );
    assert.deepEqual(perms.servers.Filesystem.readPaths, [
      "/Users/me/Development/notes",
    ]);
    assert.deepEqual(perms.servers.Filesystem.writePaths, []);
  });

  it("write tool remembers the folder as a WRITE path (not read)", () => {
    const perms = rememberToolGrant(
      null,
      {
        serverName: "Filesystem",
        toolName: "write_file",
        args: { path: "/Users/me/Development/out/report.md" },
      },
      helpers,
    );
    assert.deepEqual(perms.servers.Filesystem.writePaths, [
      "/Users/me/Development/out",
    ]);
    assert.deepEqual(perms.servers.Filesystem.readPaths, []);
  });

  it("directory-listing tools remember the directory itself", () => {
    const perms = rememberToolGrant(
      null,
      {
        serverName: "Filesystem",
        toolName: "list_directory",
        args: { path: "/Users/me/Development" },
      },
      helpers,
    );
    assert.deepEqual(perms.servers.Filesystem.readPaths, [
      "/Users/me/Development",
    ]);
  });
});

describe("folderForPathArg", () => {
  it("uses the path itself for a `directory` arg", () => {
    assert.equal(
      folderForPathArg("directory", "/a/b", "anything", path.dirname),
      "/a/b",
    );
  });
  it("uses the parent folder for a file path", () => {
    assert.equal(
      folderForPathArg("path", "/a/b/c.txt", "read_file", path.dirname),
      "/a/b",
    );
  });
});

describe("forgetToolGrant", () => {
  const perms = {
    grantOrigin: "manual",
    servers: {
      Filesystem: {
        tools: ["read_text_file", "list_directory"],
        readPaths: ["/Users/me/Development"],
        writePaths: [],
      },
      "Gmail New": { tools: ["search_emails"], readPaths: [], writePaths: [] },
    },
  };

  it("removes just that tool, keeping the provider's other tools + folders", () => {
    const next = forgetToolGrant(perms, "Filesystem", "list_directory");
    assert.deepEqual(next.servers.Filesystem.tools, ["read_text_file"]);
    assert.deepEqual(next.servers.Filesystem.readPaths, [
      "/Users/me/Development",
    ]);
  });

  it("drops the provider entirely (incl. folders) when its last tool is forgotten", () => {
    const next = forgetToolGrant(perms, "Gmail New", "search_emails");
    assert.equal("Gmail New" in next.servers, false);
    assert.ok(next.servers.Filesystem);
  });

  it("is a no-op for a tool that isn't remembered", () => {
    const next = forgetToolGrant(perms, "Slack", "post_message");
    assert.deepEqual(next, perms);
  });
});

describe("summarizeGrants", () => {
  it("returns remembered tools + folders per provider for the bot form", () => {
    const s = summarizeGrants({
      servers: {
        Filesystem: {
          tools: ["read_text_file"],
          readPaths: ["/a"],
          writePaths: ["/b"],
        },
      },
    });
    assert.deepEqual(s, {
      Filesystem: { tools: ["read_text_file"], folders: ["/a", "/b"] },
    });
  });
  it("returns {} for no grant", () => {
    assert.deepEqual(summarizeGrants(null), {});
  });
});

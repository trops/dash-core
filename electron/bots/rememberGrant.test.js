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
  canRemember,
  rememberBuiltinGrant,
  builtinAllowed,
  forgetBuiltinGrant,
  forgetFolders,
  alwaysAllowedRows,
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

describe("Always allow for a built-in web fetch", () => {
  const fetchAsk = (url) => ({
    botId: "b1",
    toolName: "WebFetch",
    input: { url, prompt: "summarize" },
  });

  it("can be offered for a provider tool or a web fetch — not other built-ins", () => {
    assert.equal(
      canRemember({ botId: "b1", serverName: "Gmail", toolName: "search" }),
      true,
    );
    assert.equal(canRemember(fetchAsk("https://news.example.com/today")), true);
    assert.equal(
      canRemember({ botId: "b1", toolName: "Bash", input: {} }),
      false,
    );
    assert.equal(canRemember({ botId: "b1", toolName: "WebSearch" }), false);
    assert.equal(canRemember(fetchAsk("file:///etc/passwd")), false);
    assert.equal(canRemember(fetchAsk("not a url")), false);
  });

  it("the whole site: any page at that origin — not other hosts, ports or http", () => {
    const g = rememberBuiltinGrant(null, {
      ...fetchAsk("https://News.Example.com/today#top"),
      scope: "site",
    });
    assert.deepEqual(g.domains.webFetch, {
      hosts: ["https://news.example.com"],
      urls: [],
    });
    assert.equal(g.grantOrigin, "manual");
    const yes = (u) => builtinAllowed(g, "WebFetch", { url: u });
    assert.equal(yes("https://news.example.com/other"), true);
    assert.equal(yes("https://NEWS.example.com:443/x"), true);
    assert.equal(yes("http://news.example.com/"), false);
    assert.equal(yes("https://news.example.com:8080/"), false);
    assert.equal(yes("https://user@news.example.com.evil.test/"), false);
    assert.equal(yes("https://cdn.news.example.com/x"), false);
    assert.equal(yes("https://example.com/"), false);
    assert.equal(
      builtinAllowed(g, "Bash", { url: "https://news.example.com/" }),
      false,
    );
  });

  it("only this page: that exact page (without its #part), nothing else", () => {
    const g = rememberBuiltinGrant(null, {
      ...fetchAsk("https://news.example.com/today#top"),
      scope: "page",
    });
    assert.deepEqual(g.domains.webFetch.urls, [
      "https://news.example.com/today",
    ]);
    const yes = (u) => builtinAllowed(g, "WebFetch", { url: u });
    assert.equal(yes("https://news.example.com/today"), true);
    assert.equal(yes("https://news.example.com/today#later"), true);
    assert.equal(yes("https://news.example.com/tomorrow"), false);
  });

  it("keeps the bot's provider grants and doesn't change the input", () => {
    const before = {
      servers: { Gmail: { tools: ["search"], readPaths: [], writePaths: [] } },
    };
    const copy = JSON.parse(JSON.stringify(before));
    const g = rememberBuiltinGrant(before, fetchAsk("https://a.example/"));
    assert.deepEqual(before, copy);
    assert.deepEqual(g.servers, before.servers);
    assert.equal(
      rememberBuiltinGrant(before, { toolName: "Bash", input: {} }),
      null,
    );
  });

  it("forgets one site or page; the last one removes the web fetch part", () => {
    let g = rememberBuiltinGrant(null, fetchAsk("https://a.example/x"));
    g = rememberBuiltinGrant(g, {
      ...fetchAsk("https://b.example/y"),
      scope: "page",
    });
    g = forgetBuiltinGrant(g, "WebFetch", { site: "https://a.example" });
    assert.deepEqual(g.domains.webFetch, {
      hosts: [],
      urls: ["https://b.example/y"],
    });
    g = forgetBuiltinGrant(g, "WebFetch", { page: "https://b.example/y" });
    assert.equal(g.domains.webFetch, undefined);
  });

  it("lists everything the bot runs without asking, one row each", () => {
    let g = rememberToolGrant(
      null,
      {
        serverName: "Files",
        toolName: "read_file",
        args: { path: "/notes/a.md" },
      },
      helpers,
    );
    g = rememberBuiltinGrant(g, fetchAsk("https://a.example/x"));
    g = rememberBuiltinGrant(g, {
      ...fetchAsk("https://b.example/y"),
      scope: "page",
    });
    assert.deepEqual(alwaysAllowedRows(g), [
      {
        kind: "tool",
        provider: "Files",
        tool: "read_file",
        folders: ["/notes"],
      },
      { kind: "builtin", tool: "WebFetch", site: "https://a.example" },
      { kind: "builtin", tool: "WebFetch", page: "https://b.example/y" },
    ]);
    assert.deepEqual(alwaysAllowedRows(null), []);
  });
});

describe("forgetFolders — Undo takes back folders an answer added", () => {
  it("removes only those folders, keeping tools and other folders", () => {
    const g = {
      servers: {
        Files: {
          tools: ["read_file"],
          readPaths: ["/a", "/b"],
          writePaths: ["/b"],
        },
      },
    };
    const next = forgetFolders(g, "Files", ["/b"]);
    assert.deepEqual(next.servers.Files, {
      tools: ["read_file"],
      readPaths: ["/a"],
      writePaths: [],
    });
    assert.equal(g.servers.Files.readPaths.length, 2);
    assert.equal(forgetFolders(g, "Files", []), g);
    assert.equal(forgetFolders(g, "Nope", ["/a"]), g);
  });
});

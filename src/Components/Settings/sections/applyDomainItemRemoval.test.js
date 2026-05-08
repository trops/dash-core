/**
 * applyDomainItemRemoval.test.js
 *
 * Pin for the helper that removes a single item from a domain-shaped
 * grant block (`granted.domains.fs.readPaths`, `.writePaths`,
 * `.actions`, or `granted.domains.network.hosts`, `.actions`). The
 * MCP-server-shaped helper (applyPathRemoval) handles the
 * `granted.servers[name]` shape; this one handles the parallel
 * `granted.domains[name]` shape used by Slice 2's fs gate and Slice
 * 3's network gate.
 *
 * Returns null when the resulting grant has no surviving content
 * (no servers, no domains) — callers full-revoke instead of writing
 * an empty grant the gate would reject.
 */
"use strict";

import { applyDomainItemRemoval } from "./applyDomainItemRemoval";

describe("applyDomainItemRemoval", () => {
  test("removes a single fs read filename", () => {
    const grant = {
      servers: {},
      domains: {
        fs: { readPaths: ["a.json", "b.json"], writePaths: [], actions: [] },
      },
    };
    const out = applyDomainItemRemoval(grant, "fs", "readPaths", "a.json");
    expect(out.domains.fs.readPaths).toEqual(["b.json"]);
  });

  test("removes a single fs write filename", () => {
    const grant = {
      servers: {},
      domains: {
        fs: { readPaths: [], writePaths: ["x.json", "y.json"], actions: [] },
      },
    };
    const out = applyDomainItemRemoval(grant, "fs", "writePaths", "x.json");
    expect(out.domains.fs.writePaths).toEqual(["y.json"]);
  });

  test("removes a single fs action", () => {
    const grant = {
      servers: {},
      domains: {
        fs: {
          readPaths: ["a"],
          writePaths: [],
          actions: ["readFromFile", "saveToFile"],
        },
      },
    };
    const out = applyDomainItemRemoval(grant, "fs", "actions", "saveToFile");
    expect(out.domains.fs.actions).toEqual(["readFromFile"]);
  });

  test("removes a network host", () => {
    const grant = {
      servers: {},
      domains: {
        network: {
          hosts: ["api.example.com", "*.foo.com"],
          actions: ["fetch"],
        },
      },
    };
    const out = applyDomainItemRemoval(
      grant,
      "network",
      "hosts",
      "api.example.com",
    );
    expect(out.domains.network.hosts).toEqual(["*.foo.com"]);
  });

  test("removes a network action", () => {
    const grant = {
      servers: {},
      domains: {
        network: { hosts: ["api.x.com"], actions: ["fetch", "post"] },
      },
    };
    const out = applyDomainItemRemoval(grant, "network", "actions", "post");
    expect(out.domains.network.actions).toEqual(["fetch"]);
  });

  test("drops the domain when its last item is removed", () => {
    const grant = {
      servers: {
        Slack: { tools: ["t"], readPaths: [], writePaths: [] },
      },
      domains: {
        fs: { readPaths: ["a.json"], writePaths: [], actions: [] },
      },
    };
    const out = applyDomainItemRemoval(grant, "fs", "readPaths", "a.json");
    expect(out.domains).toEqual({}); // entire fs block pruned
    expect(out.servers.Slack).toBeDefined(); // unrelated content preserved
  });

  test("returns null when grant becomes structurally empty", () => {
    const grant = {
      servers: {},
      domains: {
        fs: { readPaths: ["a.json"], writePaths: [], actions: [] },
      },
    };
    const out = applyDomainItemRemoval(grant, "fs", "readPaths", "a.json");
    expect(out).toBeNull();
  });

  test("removing an item that isn't there is a safe no-op", () => {
    const grant = {
      servers: {},
      domains: {
        fs: { readPaths: ["a.json"], writePaths: [], actions: [] },
      },
    };
    const out = applyDomainItemRemoval(
      grant,
      "fs",
      "readPaths",
      "missing.json",
    );
    expect(out.domains.fs.readPaths).toEqual(["a.json"]);
  });

  test("ignores unknown domain", () => {
    const grant = {
      servers: { Slack: { tools: ["t"], readPaths: [], writePaths: [] } },
      domains: {},
    };
    const out = applyDomainItemRemoval(grant, "garbage", "hosts", "x.com");
    // Returns a copy, not null, since servers still has content.
    expect(out).not.toBeNull();
    expect(out.servers.Slack).toBeDefined();
  });

  test("ignores unknown kind for fs domain", () => {
    const grant = {
      servers: { Slack: { tools: ["t"], readPaths: [], writePaths: [] } },
      domains: { fs: { readPaths: ["a"], writePaths: [], actions: [] } },
    };
    const out = applyDomainItemRemoval(grant, "fs", "garbage", "a");
    expect(out.domains.fs.readPaths).toEqual(["a"]);
  });

  test("does not mutate the input grant", () => {
    const grant = {
      servers: { Slack: { tools: ["t"], readPaths: [], writePaths: [] } },
      domains: {
        fs: { readPaths: ["a", "b"], writePaths: [], actions: [] },
      },
    };
    const before = JSON.parse(JSON.stringify(grant));
    applyDomainItemRemoval(grant, "fs", "readPaths", "a");
    expect(grant).toEqual(before);
  });

  test("bad input handled gracefully", () => {
    expect(applyDomainItemRemoval(null, "fs", "readPaths", "x")).toBeNull();
    expect(applyDomainItemRemoval({}, "fs", "readPaths", "x")).toBeNull();
    expect(
      applyDomainItemRemoval({ domains: {} }, "fs", "readPaths", ""),
    ).toBeNull();
  });
});

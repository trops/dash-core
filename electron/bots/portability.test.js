/**
 * portability.test.js
 *
 * Enforces PRD NFR-006: the Bot Factory *core* must not depend on Electron, so
 * the same code can run in-process today and as a standalone `dash-bot-runner`
 * process later. Two guards:
 *   1. Static — no core module may `require("electron")` / `require("electron-store")`.
 *   2. Dynamic — every core module actually loads under plain Node (this test
 *      runs in `node --test`, i.e. no Electron runtime).
 *
 * The Electron coupling is allowed to live in exactly one place — host.js —
 * which this test confirms is the boundary (and therefore does NOT load here).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// Core modules — everything under electron/bots except the host adapter.
const CORE_MODULES = [
  "./botSchema",
  "./BotStore",
  "./approvals",
  "./mcpResult",
  "./BotScheduler",
  // PermissionGate + BotRunner are portable: they take all Electron-coupled
  // collaborators (grant gate, MCP execution, provider resolution, approvals)
  // via injection. PermissionGate's convenience default for `gate` requires the
  // Electron-wired permissionGate lazily, at call time — never at module load —
  // so both load clean in plain Node.
  "./PermissionGate",
  "./BotRunner",
  "./engines/BotEngine",
  "./engines/eventStream",
  "./engines/toolLoopEngine",
  "./engines/index",
  "./engines/adapters/anthropicAdapter",
  "./engines/adapters/openAICompatibleAdapter",
];

const ELECTRON_REQUIRE = /require\(\s*["'](electron|electron-store)["']\s*\)/;

describe("Bot Factory core portability (NFR-006)", () => {
  it("no core module imports electron or electron-store", () => {
    for (const rel of CORE_MODULES) {
      const file = require.resolve(rel);
      const src = fs.readFileSync(file, "utf8");
      assert.ok(
        !ELECTRON_REQUIRE.test(src),
        `${rel} must not require electron/electron-store (NFR-006)`,
      );
    }
  });

  it("every core module loads under plain Node", () => {
    for (const rel of CORE_MODULES) {
      assert.doesNotThrow(
        () => require(rel),
        `${rel} failed to load in plain Node`,
      );
    }
  });

  it("host.js is the Electron boundary (carries the coupling, not loaded here)", () => {
    const src = fs.readFileSync(path.join(__dirname, "host.js"), "utf8");
    assert.ok(
      ELECTRON_REQUIRE.test(src),
      "host.js is expected to be the one module that touches Electron",
    );
  });
});

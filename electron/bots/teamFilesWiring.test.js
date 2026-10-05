/**
 * Static wiring pins for team export/import (bot-teams TEAM-006/007, slice
 * 1). The controller needs Electron, so — like other controller pins — these
 * check the source for the load-bearing guarantees.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ctrl = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);
const api = fs.readFileSync(
  path.join(__dirname, "..", "api", "botApi.js"),
  "utf8",
);
const events = require("../events/botEvents");
const { safeFileName } = require("../controller/teamFiles");

describe("team export/import — wiring", () => {
  it("has IPC channels for export, preview and install", () => {
    assert.equal(events.BOTS_EXPORT_TEAM, "bots-export-team");
    assert.equal(events.BOTS_PREVIEW_TEAM_IMPORT, "bots-preview-team-import");
    assert.equal(events.BOTS_INSTALL_TEAM, "bots-install-team");
  });

  it("exposes exportTeam / previewTeamImport / installTeam to the renderer", () => {
    assert.match(api, /exportTeam: \(workspaceId, meta\) =>/);
    assert.match(api, /previewTeamImport: \(workspaceId\) =>/);
    assert.match(
      api,
      /installTeam: \(workspaceId, manifest, choices, roles\) =>/,
    );
  });

  it("installTeam re-checks the manifest instead of trusting the renderer", () => {
    assert.match(
      ctrl,
      /installTeam\(workspaceId, manifest, choices = \{\}, roles = null\) \{\s*const \{ valid, errors, manifest: clean \} = validateTeamManifest\(manifest\);/,
    );
  });

  it("installs every member paused, then wires the new bots", () => {
    assert.match(
      ctrl,
      /for \(const member of plan\.members\) \{\s*const bot = this\.save\([\s\S]{0,300}this\._pause\.pauseBot\(bot\.id\);/,
    );
    assert.match(ctrl, /wireTeam\(plan\.wiring, created\)/);
  });

  it("names exported files safely", () => {
    assert.equal(
      safeFileName("Daily Brief (test)"),
      "Daily Brief test.team.json",
    );
    assert.equal(safeFileName("../../etc/passwd"), "etcpasswd.team.json");
    assert.equal(safeFileName(""), "team.team.json");
  });
});

describe("registry publish — wiring (TEAM-006 slice 3a)", () => {
  it("has IPC channels and renderer API for preview + publish", () => {
    assert.equal(events.BOTS_PREVIEW_PUBLISH, "bots-preview-publish");
    assert.equal(events.BOTS_PUBLISH, "bots-publish");
    assert.match(api, /previewPublish: \(opts\) =>/);
    assert.match(
      api,
      /publish: \(opts\) => ipcRenderer\.invoke\(BOTS_PUBLISH, opts\)/,
    );
  });

  it("rebuilds the package in the main process and checks fields first", () => {
    assert.match(
      ctrl,
      /async publish\(opts = \{\}\) \{[\s\S]{0,200}checkPublishMeta\(meta\)[\s\S]{0,200}this\._publishable\(opts\)/,
    );
  });

  it("publishes under the signed-in user's username, private unless public", () => {
    assert.match(ctrl, /scope: identity\.username/);
    assert.match(ctrl, /meta\.visibility === "public" \? "public" : "private"/);
  });

  it("never publishes a team lead", () => {
    assert.match(
      ctrl,
      /if \(isLead\(bot\)\) return \{ error: "A team lead can't be published\." \}/,
    );
  });
});

describe("registry publish — cache", () => {
  it("refreshes the registry index after a successful publish", () => {
    const pub = fs.readFileSync(
      path.join(__dirname, "..", "controller", "botPublish.js"),
      "utf8",
    );
    assert.match(
      pub,
      /if \(result && result\.success\) \{[\s\S]{0,300}fetchRegistryIndex\(true\)/,
    );
  });
});

describe("registry install — wiring (TEAM-007 slice 3b)", () => {
  it("has IPC channels and renderer API for search, preview and install", () => {
    assert.equal(events.BOTS_SEARCH_REGISTRY, "bots-search-registry");
    assert.equal(
      events.BOTS_PREVIEW_REGISTRY_INSTALL,
      "bots-preview-registry-install",
    );
    assert.equal(
      events.BOTS_INSTALL_FROM_REGISTRY,
      "bots-install-from-registry",
    );
    assert.match(api, /searchRegistry: \(opts\) =>/);
    assert.match(api, /previewRegistryInstall: \(workspaceId, packageRef\) =>/);
    assert.match(
      api,
      /installFromRegistry: \(workspaceId, previewId, choices, roles\) =>/,
    );
  });

  it("installs from the main process's checked copy, not the renderer's", () => {
    assert.match(
      ctrl,
      /this\._registryPreviews\.set\(previewId, \{ manifest: read\.manifest, source \}\)/,
    );
    assert.match(
      ctrl,
      /installFromRegistry\(workspaceId, previewId, choices = \{\}, roles = null\) \{\s*const preview =\s*this\._registryPreviews && this\._registryPreviews\.get\(previewId\);/,
    );
  });

  it("records where registry bots came from, and installs them paused", () => {
    assert.match(ctrl, /installedFrom: \{ \.\.\.source, role: member\.role \}/);
    assert.match(ctrl, /this\._pause\.pauseBot\(bot\.id\);/);
  });

  it("verifies the download before opening the zip", () => {
    const dl = fs.readFileSync(
      path.join(__dirname, "..", "controller", "botRegistryInstall.js"),
      "utf8",
    );
    const verifyAt = dl.indexOf("verifyDownloadedPackage({");
    const openAt = dl.indexOf("new AdmZip(zipBuffer)");
    assert.ok(verifyAt > 0 && openAt > verifyAt);
  });
});

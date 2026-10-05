/**
 * teamFiles.js
 *
 * Save and open `.team.json` files (bot-teams TEAM-006/007, slice 1) through
 * the native dialogs. Thin on purpose: what goes in a team file, and what an
 * opened one may contain, is decided by electron/bots/teamManifest.js.
 */
"use strict";

const fs = require("fs");

// A team file is small JSON; anything bigger isn't one.
const MAX_TEAM_FILE_BYTES = 1024 * 1024;

function safeFileName(name) {
  const base = String(name || "team")
    .replace(/[^A-Za-z0-9 _-]+/g, "")
    .trim()
    .slice(0, 80);
  return `${base || "team"}.team.json`;
}

/** @returns {Promise<{ saved: boolean, canceled?: boolean, filePath?: string }>} */
async function saveTeamFile(win, manifest, name) {
  const { dialog } = require("electron");
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Export team",
    defaultPath: safeFileName(name),
    filters: [{ name: "Dash team", extensions: ["json"] }],
  });
  if (canceled || !filePath) return { saved: false, canceled: true };
  await fs.promises.writeFile(
    filePath,
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  return { saved: true, filePath };
}

/**
 * @returns {Promise<{ canceled: true } | { error: string } | { text: string, fileName: string }>}
 */
async function openTeamFile(win) {
  const { dialog } = require("electron");
  const path = require("path");
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Import team",
    filters: [{ name: "Dash team", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths || !filePaths.length) return { canceled: true };
  const filePath = filePaths[0];
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_TEAM_FILE_BYTES) {
    return { error: "That file is too large to be a team file." };
  }
  return {
    text: await fs.promises.readFile(filePath, "utf8"),
    fileName: path.basename(filePath),
  };
}

module.exports = { saveTeamFile, openTeamFile, safeFileName };

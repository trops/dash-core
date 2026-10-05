/**
 * botPublish.js
 *
 * Zip a bot or team package and publish it to the Dash registry (bot-teams
 * TEAM-006 slice 3a). Thin on purpose: what goes in the package is decided
 * by electron/bots/botPackage.js; signing and upload are the existing
 * registryApiController.publishToRegistry (the same path themes use).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/** Registry sign-in state and the username that becomes the package scope. */
async function registryIdentity() {
  const {
    getAuthStatus,
    getRegistryProfile,
  } = require("./registryAuthController");
  if (!getAuthStatus().authenticated) return { signedIn: false };
  const profile = await getRegistryProfile();
  if (!profile || !profile.username) return { signedIn: false };
  return {
    signedIn: true,
    username: profile.username,
    displayName: profile.displayName || profile.username,
  };
}

/**
 * @param {Array<{ name: string, text: string }>} files  botPackage.publishFiles
 * @param {object} manifest  the registry manifest
 */
async function zipAndPublish(files, manifest) {
  const AdmZip = require("adm-zip");
  const registryApiController = require("./registryApiController");
  const zip = new AdmZip();
  for (const f of files) zip.addFile(f.name, Buffer.from(f.text, "utf8"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-bot-publish-"));
  const zipPath = path.join(dir, `${manifest.name}-${manifest.version}.zip`);
  try {
    zip.writeZip(zipPath);
    const result = await registryApiController.publishToRegistry(
      zipPath,
      manifest,
    );
    if (result && result.success) {
      // The registry index is cached for 5 minutes — refresh it so the new
      // package shows up in search and installs right away.
      try {
        await require("./registryController").fetchRegistryIndex(true);
      } catch (_e) {
        // Best effort: the cache expires on its own.
      }
    }
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { registryIdentity, zipAndPublish };

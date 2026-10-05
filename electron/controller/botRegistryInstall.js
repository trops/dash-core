/**
 * botRegistryInstall.js
 *
 * Download a bot or team package from the Dash registry, verify its
 * signature, and return its files (bot-teams TEAM-007 slice 3b). Follows the
 * same path as theme installs (themeRegistryController.installThemeFromRegistry):
 * look the package up, fetch /download, follow the storage URL, then
 * verifyDownloadedPackage (signature + publisher cert + revocation) BEFORE
 * the zip is opened. What the files may contain is decided by
 * electron/bots/botPackage.js (readPackageFiles).
 */
"use strict";

// Bot and team packages are a few JSON files; anything bigger isn't one.
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;

function registryBaseUrl() {
  return (
    process.env.DASH_REGISTRY_API_URL ||
    "https://main.d919rwhuzp7rj.amplifyapp.com"
  );
}

/**
 * @param {string} packageRef  "scope/name" (any form registryController.getPackage accepts)
 * @returns {Promise<{ files: { [path]: string }, pkg: object } |
 *                   { error: string, authRequired?: boolean }>}
 */
async function downloadBotPackage(packageRef) {
  const registryController = require("./registryController");
  const { getStoredToken, clearToken } = require("./registryAuthController");

  const pkg = await registryController.getPackage(packageRef);
  if (!pkg) return { error: `"${packageRef}" wasn't found in the registry.` };
  if (pkg.type !== "bot" && pkg.type !== "bot-team") {
    return { error: `"${packageRef}" isn't a bot or a team.` };
  }
  const auth = getStoredToken();
  if (!auth) {
    return {
      error: "Sign in to the Dash registry to install.",
      authRequired: true,
    };
  }

  const version = pkg.version || pkg.latestVersion || "1.0.0";
  const scopePath = pkg.scope ? `${encodeURIComponent(pkg.scope)}/` : "";
  const url = `${registryBaseUrl()}/api/packages/${scopePath}${encodeURIComponent(pkg.name)}/download?version=${encodeURIComponent(version)}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
  } catch (e) {
    return { error: `Couldn't reach the registry (${e.message}).` };
  }
  if (response.status === 401) {
    clearToken();
    return {
      error: "Your registry session expired. Sign in again.",
      authRequired: true,
    };
  }
  if (!response.ok) {
    return {
      error: `The registry returned ${response.status} for "${packageRef}".`,
    };
  }

  // The registry answers with JSON: a storage URL for the zip plus the
  // publisher's signing metadata.
  let meta;
  try {
    meta = await response.json();
  } catch (_e) {
    return { error: "The registry's download response wasn't valid JSON." };
  }
  if (meta.error) return { error: meta.error };
  if (!meta.downloadUrl)
    return { error: "The registry didn't return a download link." };

  let zipResponse;
  try {
    zipResponse = await fetch(meta.downloadUrl);
  } catch (e) {
    return { error: `Couldn't download the package (${e.message}).` };
  }
  if (!zipResponse.ok) {
    return { error: `Storage returned ${zipResponse.status} for the package.` };
  }
  const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
  if (!zipBuffer.length) return { error: "The package download was empty." };
  if (zipBuffer.length > MAX_PACKAGE_BYTES) {
    return { error: "That package is too large to be a bot or team." };
  }

  // Verify before opening (strict mode throws; warn mode logs and continues,
  // the app-wide default shared with themes and widgets).
  try {
    const {
      verifyDownloadedPackage,
    } = require("../security/verifyRegistryInstall");
    const result = await verifyDownloadedPackage({
      zipBuffer,
      zipSignature: meta.zipSignature || null,
      publisherCert: meta.publisherCert || null,
      publisherKeyId: meta.publisherKeyId || null,
      publisherFingerprint: meta.publisherFingerprint || null,
    });
    if (!result.verified && result.mode === "warn") {
      console.warn(
        `[BotRegistryInstall] Installing unverified package "${packageRef}" — ${result.reason}`,
      );
    }
  } catch (e) {
    return { error: `The package failed verification: ${e.message || e}` };
  }

  const AdmZip = require("adm-zip");
  const files = {};
  try {
    for (const entry of new AdmZip(zipBuffer).getEntries()) {
      if (entry.isDirectory || !/\.json$/i.test(entry.entryName)) continue;
      files[entry.entryName] = entry.getData().toString("utf8");
    }
  } catch (_e) {
    return { error: "The package isn't a readable zip." };
  }
  return {
    files,
    pkg: {
      scope: pkg.scope || null,
      name: pkg.name,
      version,
      displayName: pkg.displayName || pkg.name,
      author: pkg.author || pkg.scope || "",
      type: pkg.type,
      visibility: pkg.visibility || null,
    },
  };
}

module.exports = { downloadBotPackage };

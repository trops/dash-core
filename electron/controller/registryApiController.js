/**
 * registryApiController.js
 *
 * Client for the Dash registry API.
 * Handles publishing packages and generating registry URLs.
 */
const fs = require("fs");
const path = require("path");
const { getStoredToken } = require("./registryAuthController");
const { signZipBuffer } = require("./publisherKeyController");

const REGISTRY_BASE_URL =
  process.env.DASH_REGISTRY_API_URL ||
  "https://main.d919rwhuzp7rj.amplifyapp.com";

/**
 * Publish a package to the registry.
 *
 * Signs the ZIP with the local publisher key (auto-generating + registering
 * one on first use) and attaches `signature` + `publisherCert` + `publisherKeyId`
 * to the multipart form so the registry can verify provenance.
 *
 * @param {string} zipPath - Path to the ZIP file
 * @param {Object} manifest - Package manifest JSON
 * @returns {Promise<Object>} { success, registryUrl, packageId, version, error? }
 */
async function publishToRegistry(zipPath, manifest) {
  const auth = getStoredToken();
  if (!auth) {
    return {
      success: false,
      error: "Not authenticated with registry",
      authRequired: true,
    };
  }

  try {
    // Read the ZIP file
    const zipBuffer = fs.readFileSync(zipPath);

    // Sign the ZIP with the local publisher key. First-call generates
    // the keypair locally, registers the public half with the registry,
    // and caches the resulting cert; subsequent calls reuse it. The
    // private key never leaves the main process.
    let signing;
    try {
      signing = await signZipBuffer(new Uint8Array(zipBuffer));
    } catch (signErr) {
      // Auth-required during keygen surfaces the same flag the publish
      // handler already understands; other errors halt the publish so
      // we never ship an unsigned ZIP from this path.
      if (signErr && signErr.authRequired) {
        return {
          success: false,
          error: signErr.message || "Not authenticated with registry",
          authRequired: true,
        };
      }
      return {
        success: false,
        error: `Could not sign package: ${signErr && signErr.message ? signErr.message : signErr}`,
      };
    }

    // Create FormData with the ZIP, manifest, and signing fields.
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([zipBuffer], { type: "application/zip" }),
      path.basename(zipPath),
    );
    formData.append("manifest", JSON.stringify(manifest));
    formData.append("signature", signing.signature);
    formData.append("publisherCert", JSON.stringify(signing.publisherCert));
    formData.append("publisherKeyId", signing.publisherKeyId);

    // POST to registry
    const response = await fetch(`${REGISTRY_BASE_URL}/api/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `Publish failed: ${response.status}`,
        details: data.details,
      };
    }

    return {
      success: true,
      registryUrl: data.registryUrl,
      packageId: data.packageId,
      version: data.version,
      downloadUrl: data.downloadUrl,
      warnings: data.warnings,
    };
  } catch (err) {
    console.error("[RegistryApiController] Publish error:", err);
    return {
      success: false,
      error: err.message || "Failed to publish to registry",
    };
  }
}

/**
 * Bulk-resolve package refs to their registry state. Used by the
 * batch-publish dialog to decorate dependency rows with ownership +
 * latest version + visibility.
 *
 * Sends token if available (authenticated callers see their private
 * packages too). Anonymous calls still work — only public data is
 * returned.
 *
 * @param {Array<{scope: string, name: string}>} refs
 * @returns {Promise<Object>} { success, resolved: [...], error? }
 */
async function resolvePackages(refs) {
  if (!Array.isArray(refs) || refs.length === 0) {
    return { success: true, resolved: [] };
  }

  try {
    const headers = { "Content-Type": "application/json" };
    const auth = getStoredToken();
    if (auth?.token) {
      headers.Authorization = `Bearer ${auth.token}`;
    }

    const response = await fetch(`${REGISTRY_BASE_URL}/api/packages/resolve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refs }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        success: false,
        error: data?.error || `Resolve failed: ${response.status}`,
      };
    }

    return { success: true, resolved: Array.isArray(data) ? data : [] };
  } catch (err) {
    console.error("[RegistryApiController] Resolve error:", err);
    return {
      success: false,
      error: err.message || "Failed to resolve packages",
    };
  }
}

/**
 * Get the registry URL for a published package.
 *
 * @param {string} scope - Package scope (username)
 * @param {string} name - Package name
 * @returns {string} Full registry URL
 */
function getRegistryUrl(scope, name) {
  return `${REGISTRY_BASE_URL}/package/${scope}/${name}`;
}

module.exports = {
  publishToRegistry,
  resolvePackages,
  getRegistryUrl,
  REGISTRY_BASE_URL,
};

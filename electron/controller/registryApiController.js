/**
 * registryApiController.js
 *
 * Client for the Dash registry API.
 * Handles publishing packages and generating registry URLs.
 */
const fs = require("fs");
const path = require("path");
const { getStoredToken } = require("./registryAuthController");

const REGISTRY_BASE_URL =
    process.env.DASH_REGISTRY_API_URL || "https://registry.trops.dev";

/**
 * Publish a package to the registry.
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

        // Create FormData with the ZIP and manifest
        const formData = new FormData();
        formData.append(
            "file",
            new Blob([zipBuffer], { type: "application/zip" }),
            path.basename(zipPath),
        );
        formData.append("manifest", JSON.stringify(manifest));

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
    getRegistryUrl,
    REGISTRY_BASE_URL,
};

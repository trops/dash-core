/**
 * providerController.js
 *
 * Handle provider (credentials) management with encryption
 * Saves encrypted credentials to ~/.userData/Dashboard/{appId}/providers.json
 */
const { app, safeStorage } = require("electron");
const path = require("path");
const { writeFileSync, readFileSync, existsSync } = require("fs");
const {
  ensureDirectoryExistence,
  getFileContents,
  writeToFile,
} = require("../utils/file");

const appName = "Dashboard";
const configFilename = "providers.json";

const providerController = {
  /**
   * saveProvider
   * Save a new provider with encrypted credentials
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id
   * @param {string} providerName user-defined name (e.g., "Algolia Production")
   * @param {string} providerType provider type (e.g., "algolia", "slack")
   * @param {object} credentials credentials object
   * @param {string} providerClass "credential" (default) or "mcp"
   * @param {object} mcpConfig MCP server config (transport, command, args, envMapping) - only for providerClass "mcp"
   * @param {string[]|null} allowedTools optional list of allowed tool names - only for providerClass "mcp"
   * @param {object} wsConfig WebSocket config (url, headers, subprotocols) - only for providerClass "websocket"
   * @param {boolean} [isDefaultForType=false] mark this provider as the app-wide default for its type.
   *   Single-winner invariant: if true, every other provider with the same
   *   `providerType` has its `isDefaultForType` cleared in the same save.
   *   Consumed by the 3-layer resolution in `useMcpProvider`.
   */
  saveProvider: (
    win,
    appId,
    providerName,
    providerType,
    credentials,
    providerClass = "credential",
    mcpConfig = null,
    allowedTools = null,
    wsConfig = null,
    // `undefined` means "preserve whatever the saved provider has";
    // explicit `true`/`false` flips the flag.
    isDefaultForType = undefined,
  ) => {
    try {
      // Build file path
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );

      // Ensure directory exists
      ensureDirectoryExistence(filename);

      // Load existing providers
      const providers = getFileContents(filename, {});

      // Encrypt credentials
      const credentialsJson = JSON.stringify(credentials);
      const encryptedCredentials = safeStorage.encryptString(credentialsJson);

      // Add/update provider
      const providerEntry = {
        type: providerType,
        providerClass: providerClass || "credential",
        credentials: encryptedCredentials.toString("base64"),
        dateCreated:
          providers[providerName]?.dateCreated || new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
      };

      // Add mcpConfig for MCP providers
      if (providerClass === "mcp" && mcpConfig) {
        providerEntry.mcpConfig = mcpConfig;
      }

      // Add allowedTools for MCP providers
      if (providerClass === "mcp" && allowedTools) {
        providerEntry.allowedTools = allowedTools;
      }

      // Add wsConfig for WebSocket providers
      if (providerClass === "websocket" && wsConfig) {
        providerEntry.wsConfig = wsConfig;
      }

      // Preserve existing flag if caller didn't pass one; otherwise honor
      // the caller's value. Explicit false from the caller MUST clear an
      // existing true flag — this is how the "unset default" path works.
      const prev = providers[providerName] || {};
      if (typeof isDefaultForType === "boolean") {
        providerEntry.isDefaultForType = isDefaultForType;
      } else if (prev.isDefaultForType) {
        providerEntry.isDefaultForType = true;
      }

      // Preserve any OAuth state (tokens / DCR client info / PKCE verifier)
      // written out-of-band by saveOAuthState. A fresh providerEntry would
      // otherwise drop it, wiping tokens whenever the user edits/re-saves an
      // OAuth MCP provider.
      if (prev.oauth) {
        providerEntry.oauth = prev.oauth;
      }

      // Single-winner invariant: when flipping this provider's flag to
      // true, clear it on every other provider with the same type. Run
      // this BEFORE we set `providers[providerName] = providerEntry` so
      // self is excluded naturally. Stable per-type: clearing siblings
      // only touches `isDefaultForType` + `dateUpdated`, nothing else.
      if (providerEntry.isDefaultForType) {
        for (const [name, data] of Object.entries(providers)) {
          if (name === providerName) continue;
          if (data?.type === providerType && data?.isDefaultForType) {
            data.isDefaultForType = false;
            data.dateUpdated = new Date().toISOString();
          }
        }
      }

      providers[providerName] = providerEntry;

      // Save to file with restrictive permissions (owner read/write only)
      writeFileSync(filename, JSON.stringify(providers, null, 2), {
        mode: 0o600,
      });

      console.log(
        `[providerController] Provider saved: ${providerName} (${providerType}, ${providerClass})`,
      );

      // Invalidate any cached client so the next getClient() call uses fresh credentials
      const clientCache = require("../utils/clientCache");
      clientCache.invalidate(appId, providerName);

      // Return the data for ipcMain.handle() - modern promise-based approach
      return {
        success: true,
        providerName,
        providerType,
        providerClass,
      };
    } catch (error) {
      console.error("[providerController] Error saving provider:", error);
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * listProviders
   * Get list of all providers with decrypted credentials
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id
   */
  listProviders: (win, appId) => {
    try {
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );

      // Load providers file
      const providersData = getFileContents(filename, {});

      // Load MCP catalog for merging new config fields into saved providers
      let catalog = [];
      try {
        const catalogPath = path.join(
          __dirname,
          "..",
          "mcp",
          "mcpServerCatalog.json",
        );
        if (existsSync(catalogPath)) {
          const catalogData = JSON.parse(readFileSync(catalogPath, "utf-8"));
          catalog = catalogData.servers || [];
        }
      } catch (e) {
        // Catalog is optional — merge is best-effort
      }

      // Decrypt all credentials
      const decryptedProviders = [];
      Object.entries(providersData).forEach(([name, data]) => {
        try {
          const credentialsBuffer = Buffer.from(data.credentials, "base64");
          const decryptedJson = safeStorage.decryptString(credentialsBuffer);
          const credentials = JSON.parse(decryptedJson);

          const provider = {
            name,
            type: data.type,
            providerClass: data.providerClass || "credential",
            credentials,
            dateCreated: data.dateCreated,
            dateUpdated: data.dateUpdated,
            isDefaultForType: data.isDefaultForType === true,
          };

          // Include mcpConfig for MCP providers
          if (data.mcpConfig) {
            provider.mcpConfig = data.mcpConfig;

            // Merge argsMapping from catalog if missing from saved config
            // (providers snapshot mcpConfig at creation time; this ensures
            // existing providers pick up new catalog features like argsMapping)
            if (!data.mcpConfig.argsMapping && data.type) {
              const catalogEntry = catalog.find(
                (entry) => entry.id === data.type,
              );
              if (catalogEntry?.mcpConfig?.argsMapping) {
                provider.mcpConfig.argsMapping =
                  catalogEntry.mcpConfig.argsMapping;
              }
            }
          }

          // Include allowedTools for MCP providers
          if (data.allowedTools) {
            provider.allowedTools = data.allowedTools;
          }

          // Include wsConfig for WebSocket providers
          if (data.wsConfig) {
            provider.wsConfig = data.wsConfig;
          }

          decryptedProviders.push(provider);
        } catch (decryptError) {
          console.error(
            `[providerController] Failed to decrypt provider ${name}:`,
            decryptError,
          );
          // Skip this provider if decryption fails
        }
      });

      console.log(
        `[providerController] Loaded ${decryptedProviders.length} providers`,
      );

      // Return the data for ipcMain.handle() - modern promise-based approach
      return {
        providers: decryptedProviders,
      };
    } catch (error) {
      console.error("[providerController] Error listing providers:", error);
      return {
        error: true,
        message: error.message,
        providers: [],
      };
    }
  },

  /**
   * getProvider
   * Get a specific provider by name with decrypted credentials
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id
   * @param {string} providerName the provider name to retrieve
   */
  getProvider: (win, appId, providerName) => {
    try {
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );

      // Load providers file
      const providersData = getFileContents(filename, {});

      // Find and decrypt the specific provider
      const providerData = providersData[providerName];
      if (!providerData) {
        throw new Error(`Provider not found: ${providerName}`);
      }

      const credentialsBuffer = Buffer.from(providerData.credentials, "base64");
      const decryptedJson = safeStorage.decryptString(credentialsBuffer);
      const credentials = JSON.parse(decryptedJson);

      const provider = {
        name: providerName,
        type: providerData.type,
        providerClass: providerData.providerClass || "credential",
        credentials,
        dateCreated: providerData.dateCreated,
        dateUpdated: providerData.dateUpdated,
        isDefaultForType: providerData.isDefaultForType === true,
      };

      // Include mcpConfig for MCP providers
      if (providerData.mcpConfig) {
        provider.mcpConfig = providerData.mcpConfig;
      }

      // Include allowedTools for MCP providers
      if (providerData.allowedTools) {
        provider.allowedTools = providerData.allowedTools;
      }

      // Include wsConfig for WebSocket providers
      if (providerData.wsConfig) {
        provider.wsConfig = providerData.wsConfig;
      }

      console.log(`[providerController] Provider retrieved: ${providerName}`);

      // Return the data for ipcMain.handle() - modern promise-based approach
      return {
        provider,
      };
    } catch (error) {
      console.error("[providerController] Error getting provider:", error);
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * deleteProvider
   * Delete a provider from the providers file
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id
   * @param {string} providerName the provider name to delete
   */
  deleteProvider: (win, appId, providerName) => {
    try {
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );

      // Load existing providers
      const providers = getFileContents(filename, {});

      // Delete the provider
      if (!providers.hasOwnProperty(providerName)) {
        throw new Error(`Provider not found: ${providerName}`);
      }

      delete providers[providerName];

      // Save to file with restrictive permissions (owner read/write only)
      writeFileSync(filename, JSON.stringify(providers, null, 2), {
        mode: 0o600,
      });

      console.log(`[providerController] Provider deleted: ${providerName}`);

      // Invalidate any cached client for the deleted provider
      const clientCache = require("../utils/clientCache");
      clientCache.invalidate(appId, providerName);

      // Return the data for ipcMain.handle() - modern promise-based approach
      return {
        success: true,
        providerName,
      };
    } catch (error) {
      console.error("[providerController] Error deleting provider:", error);
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * saveOAuthState
   * Persist an MCP OAuth session blob (tokens, DCR client info, PKCE
   * verifier) encrypted alongside the provider entry. Used by the SDK
   * OAuthClientProvider (mcpOAuthProvider.js). Creates a minimal MCP
   * provider entry if one doesn't exist yet, so "Authorize" can run
   * before the provider is formally saved (the later saveProvider
   * preserves this blob).
   *
   * @param {BrowserWindow} win the main window (unused; signature parity)
   * @param {string} appId the application id
   * @param {string} providerName the provider/server name
   * @param {object} oauthState { tokens?, clientInformation?, codeVerifier? }
   */
  saveOAuthState: (win, appId, providerName, oauthState) => {
    try {
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );
      ensureDirectoryExistence(filename);

      const providers = getFileContents(filename, {});
      const encrypted = safeStorage
        .encryptString(JSON.stringify(oauthState || {}))
        .toString("base64");

      const prev = providers[providerName] || {};
      providers[providerName] = {
        ...prev,
        providerClass: prev.providerClass || "mcp",
        oauth: encrypted,
        dateCreated: prev.dateCreated || new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
      };

      writeFileSync(filename, JSON.stringify(providers, null, 2), {
        mode: 0o600,
      });

      return { success: true };
    } catch (error) {
      console.error("[providerController] Error saving OAuth state:", error);
      return { error: true, message: error.message };
    }
  },

  /**
   * getOAuthState
   * Read and decrypt the OAuth session blob for a provider, or `{}` if
   * none exists. Main-process only — never surfaced to the renderer.
   *
   * @param {BrowserWindow} win the main window (unused; signature parity)
   * @param {string} appId the application id
   * @param {string} providerName the provider/server name
   * @returns {{ oauth?: object }}
   */
  getOAuthState: (win, appId, providerName) => {
    try {
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );
      const providers = getFileContents(filename, {});
      const entry = providers[providerName];
      if (!entry || !entry.oauth) return {};

      const buffer = Buffer.from(entry.oauth, "base64");
      const decrypted = safeStorage.decryptString(buffer);
      return { oauth: JSON.parse(decrypted) };
    } catch (error) {
      console.error("[providerController] Error reading OAuth state:", error);
      return {};
    }
  },
};

module.exports = providerController;

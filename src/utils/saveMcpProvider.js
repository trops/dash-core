import { uniqueProviderType } from "./providerType";

/**
 * Save a new MCP provider — shared by Settings › Providers and the draft
 * review's Add/Install dialog (bot-capabilities CAP-005), so both behave the
 * same.
 *
 * A hand-rolled custom server arrives with the generic type "custom"; give
 * each new one a unique slug so it has its own identity like catalog
 * providers. After saving, `dash:provider-installed` is announced so open
 * bot forms reload their provider list and can turn it on right away.
 *
 * @returns {Promise<{ name: string, type: string }>}
 */
export function saveMcpProvider({
  dashApi,
  appId,
  providers = {},
  name,
  type,
  credentials = {},
  mcpConfig,
  allowedTools = null,
}) {
  let resolvedType = type;
  if (resolvedType === "custom") {
    const existingTypes = Object.values(providers || {}).map((p) => p.type);
    resolvedType = uniqueProviderType(name, existingTypes);
  }
  return new Promise((resolve, reject) => {
    if (!dashApi || !appId) {
      reject(new Error("Providers can't be saved here."));
      return;
    }
    dashApi.saveProvider(
      appId,
      name,
      {
        providerType: resolvedType,
        credentials,
        providerClass: "mcp",
        mcpConfig,
        allowedTools,
      },
      () => {
        window.dispatchEvent(
          new CustomEvent("dash:provider-installed", {
            detail: { id: resolvedType, name },
          }),
        );
        resolve({ name, type: resolvedType });
      },
      (_e, err) =>
        reject(
          err instanceof Error ? err : new Error(String(err || "Save failed")),
        ),
    );
  });
}

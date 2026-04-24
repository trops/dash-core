/**
 * Return the subset of provider declarations that are user-configurable
 * (anything except `providerClass: "api"`, which is satisfied by the
 * app itself and not picked per widget).
 *
 * Tolerates malformed input: if the array contains `null`/`undefined`
 * slots (occasionally seen after a widget install where the registry
 * ships a sparse `providers` array), those entries are dropped instead
 * of crashing the whole renderer. Without the null-guard, any caller
 * inside a React `useMemo` (e.g. WidgetsSection's `uniqueProviders`)
 * throws at mount and takes the Settings → Widgets pane down with it.
 */
export const getUserConfigurableProviders = (providers) => {
  if (!Array.isArray(providers)) return [];
  return providers.filter((p) => p && p.providerClass !== "api");
};

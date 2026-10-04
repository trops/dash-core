import { useCallback, useEffect, useMemo, useState } from "react";

/** "@scope/name" for a registry package record ({ scope, name } or a full name). */
export function publishedId(pkg) {
  if (!pkg || !pkg.name) return null;
  if (String(pkg.name).startsWith("@")) return pkg.name;
  return pkg.scope ? `@${pkg.scope}/${pkg.name}` : null;
}

/**
 * useRegistryIdentity — who's signed in to the registry and what they've
 * published (app-navigation PRD NAV-012). Every user publishes only under
 * their own username as the scope, so the username decides which packages
 * are theirs. Re-read when the window regains focus (e.g. after signing in).
 */
export function useRegistryIdentity() {
  const [username, setUsername] = useState(null);
  const [published, setPublished] = useState({});

  const load = useCallback(async () => {
    const api = window.mainApi && window.mainApi.registryAuth;
    if (!api) return;
    try {
      const profile = api.getProfile ? await api.getProfile() : null;
      const name = (profile && profile.username) || null;
      setUsername(name);
      if (!name || !api.getPackages) {
        setPublished({});
        return;
      }
      const result = await api.getPackages();
      const versions = {};
      for (const pkg of (result && result.packages) || []) {
        const id = publishedId(pkg);
        if (id) versions[id] = pkg.latestVersion || pkg.version || null;
      }
      setPublished(versions);
    } catch (_e) {
      // Offline / registry down: keep what we had.
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  return useMemo(
    () => ({
      username,
      signedIn: !!username,
      publishedVersion: (id) => (id && published[id]) || null,
      refresh: load,
    }),
    [username, published, load],
  );
}

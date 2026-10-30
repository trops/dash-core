import { useEffect, useState } from "react";

/**
 * The signed-in registry username (theme change leftovers): a theme under
 * your own scope is yours, even installed on another computer. It's the
 * stored username the main process decides with (registryAuth.getStatus —
 * no network), read on mount and again when the window regains focus (after
 * signing in or out). null when signed out — then such a theme is treated as
 * downloaded (the safe side: a remix).
 */
let last = null;

async function readUsername() {
  const api =
    typeof window !== "undefined" && window.mainApi
      ? window.mainApi.registryAuth
      : null;
  if (!api || !api.getStatus) return null;
  try {
    const s = await api.getStatus();
    return (s && s.authenticated && s.username) || null;
  } catch (_e) {
    return null;
  }
}

export function useRegistryUsername() {
  const [username, setUsername] = useState(last);
  useEffect(() => {
    let alive = true;
    const load = () =>
      readUsername().then((u) => {
        last = u;
        if (alive) setUsername(u);
      });
    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, []);
  return username;
}

/** Tests: forget the last username read. */
export function resetRegistryUsername() {
  last = null;
}

export default useRegistryUsername;

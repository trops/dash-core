import { useContext, useEffect, useMemo, useState } from "react";
import { AppContext } from "../Context/App/AppContext";

/**
 * The user's providers — what each is and the tools approved for it — as
 * providers.json has them (mainApi.providers.listSummaries, nothing
 * decrypted), merged with the ones the app has loaded. A provider whose
 * sign-in can't be read here (or hasn't loaded yet) still shows, so "which
 * of my providers can do this" never comes back empty by mistake.
 *
 * @returns {object} providers keyed by name (AppContext.providers' shape)
 */
let lastSummaries = null;

export function mergeProviders(loaded, summaries) {
  const out = {};
  for (const s of Array.isArray(summaries) ? summaries : []) {
    if (s && s.name) out[s.name] = { ...s };
  }
  const list = Array.isArray(loaded) ? loaded : Object.values(loaded || {});
  for (const p of list) {
    if (p && p.name) out[p.name] = { ...(out[p.name] || {}), ...p };
  }
  return out;
}

export function useKnownProviders() {
  const app = useContext(AppContext) || {};
  const [summaries, setSummaries] = useState(lastSummaries);
  const appId = app.credentials && app.credentials.appId;
  useEffect(() => {
    const api =
      typeof window !== "undefined" && window.mainApi
        ? window.mainApi.providers
        : null;
    if (!api || typeof api.listSummaries !== "function" || !appId) {
      return undefined;
    }
    let alive = true;
    Promise.resolve(api.listSummaries(appId))
      .then((res) => {
        if (!alive || !res || !Array.isArray(res.providers)) return;
        lastSummaries = res.providers;
        setSummaries(res.providers);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // Again when the app's providers change (one added or removed).
  }, [appId, app.providers]);
  return useMemo(
    () => mergeProviders(app.providers, summaries),
    [app.providers, summaries],
  );
}

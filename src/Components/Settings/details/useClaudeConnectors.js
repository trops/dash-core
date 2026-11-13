import { useCallback, useEffect, useMemo, useState } from "react";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/**
 * useClaudeConnectors — the connectors in the user's Claude account, as
 * their signed-in Claude Code CLI reports them (the main process caches the
 * list; Check again asks again).
 *
 * @param {boolean} [enabled=true]  false: don't read them (no Claude
 *   connector providers to show).
 * @returns {{ result: { state, connectors, checkedAt, message }|null,
 *   loading: boolean, refresh: () => Promise, statusOf: (server) => string|null }}
 */
export function useClaudeConnectors(enabled = true) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // opts: { refresh, reconnect } — or true for a plain refresh.
  const load = useCallback(async (how = false) => {
    const opts = typeof how === "object" && how ? how : { refresh: !!how };
    const api = botsApi();
    if (!api || typeof api.listClaudeConnectors !== "function") {
      setResult({
        state: "error",
        connectors: [],
        message: "Claude connectors aren't available here.",
      });
      return;
    }
    setLoading(true);
    try {
      const r = await api.listClaudeConnectors(opts);
      setResult(
        r || {
          state: "error",
          connectors: [],
          message: "Couldn't read your Claude connectors.",
        },
      );
    } catch (e) {
      setResult({
        state: "error",
        connectors: [],
        message: (e && e.message) || "Couldn't read your Claude connectors.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load(false);
  }, [enabled, load]);

  // A connector's status in the account: its own, "absent" when the list was
  // read and it isn't there, or null when not known.
  return useMemo(
    () => ({
      result,
      loading,
      refresh: () => load(true),
      // Reconnect (a connector's details): a fresh link that connects the
      // account's connectors again — this one, or every one not connected —
      // and waits longer; never the cached answer.
      reconnect: (server = true) => load({ refresh: true, reconnect: server }),
      // Use this Claude Code from now on — bot runs too.
      useCli: async (path) => {
        const api = botsApi();
        if (!api || typeof api.useClaudeCli !== "function") return null;
        setLoading(true);
        try {
          const r = await api.useClaudeCli(path);
          if (r && !r.error) setResult(r);
          return r;
        } finally {
          setLoading(false);
        }
      },
      // Stop trying a connector for an hour (on), or try it now (off).
      giveUp: async (server, on = true) => {
        const api = botsApi();
        if (!api || typeof api.setConnectorGivenUp !== "function") return null;
        if (!on) setLoading(true);
        try {
          const r = await api.setConnectorGivenUp(server, on);
          if (r && r.state) setResult(r);
          else if (r && r.givenUp) {
            setResult((cur) => (cur ? { ...cur, givenUp: r.givenUp } : cur));
          }
          return r;
        } finally {
          if (!on) setLoading(false);
        }
      },
      statusOf: (server) => {
        if (!result || result.state !== "ready") return null;
        const found = (result.connectors || []).find(
          (c) => c.server === server,
        );
        return found ? found.status : "absent";
      },
    }),
    [result, loading, load],
  );
}

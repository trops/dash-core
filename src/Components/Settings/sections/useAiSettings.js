import { useCallback, useEffect, useState } from "react";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/**
 * useAiSettings — Settings › AI's data: the `ai` settings (filled in, as
 * the main process reads them), the model list with tiers and prices, and
 * the bots, leads and Dash team it applies to.
 *
 * @returns {{ ai: object|null, models: object[], bots: object[],
 *   leads: object[], team: object[], save: (patch) => Promise,
 *   saveBot: (definition) => Promise, reload: () => Promise }}
 */
export function useAiSettings() {
  const [ai, setAi] = useState(null);
  const [models, setModels] = useState([]);
  const [bots, setBots] = useState([]);
  const [leads, setLeads] = useState([]);
  const [team, setTeam] = useState([]);

  const reload = useCallback(async () => {
    const b = botsApi();
    if (!b) return;
    const safe = async (fn, fallback) => {
      try {
        return (await fn()) || fallback;
      } catch (_e) {
        return fallback;
      }
    };
    const [settings, list, leadList, teamList] = await Promise.all([
      safe(() => b.getSettings(), {}),
      safe(() => b.list(), []),
      safe(() => (b.listLeads ? b.listLeads() : []), []),
      safe(() => (b.listDashTeam ? b.listDashTeam() : []), []),
    ]);
    setAi(settings.aiResolved || null);
    setBots(Array.isArray(list) ? list.filter((x) => x.role !== "lead") : []);
    setLeads(Array.isArray(leadList) ? leadList : []);
    setTeam(Array.isArray(teamList) ? teamList : []);
  }, []);

  useEffect(() => {
    reload();
    // The curated list: it carries each model's tier and price (a live
    // fetch doesn't), which the costs and "most expensive" need.
    const llm =
      typeof window !== "undefined" && window.mainApi
        ? window.mainApi.llm
        : null;
    if (llm && llm.listModels) {
      Promise.resolve(llm.listModels("anthropic"))
        .then((res) => setModels((res && res.models) || []))
        .catch(() => setModels([]));
    }
    const b = botsApi();
    const id = b && b.onListChanged ? b.onListChanged(() => reload()) : null;
    return () => {
      if (id != null && b && b.removeListener) b.removeListener(id);
    };
  }, [reload]);

  const save = useCallback(
    async (patch) => {
      const b = botsApi();
      if (!b || !b.setSettings) return;
      await b.setSettings({ ai: patch });
      await reload();
    },
    [reload],
  );

  const saveBot = useCallback(async (definition) => {
    const b = botsApi();
    if (!b || !b.save) return null;
    return b.save(definition);
  }, []);

  return { ai, models, bots, leads, team, save, saveBot, reload };
}

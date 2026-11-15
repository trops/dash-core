import { useCallback, useEffect, useState } from "react";

function llmApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.llm
    : null;
}

/**
 * useModelList — the models every picker offers (with family, status, tier
 * and price) and the fresh list's status: when it was last checked, why a
 * check failed, and the models that just came out — and where retired
 * models are still saved (`usage`, with `move` to move them). Reloads when
 * the main process checks again (electron/llm/modelList.js).
 *
 * @returns {{ models: object[], status: object|null, checking: boolean,
 *   usage: object|null, check: () => Promise, seen: () => Promise,
 *   move: (from: string, to?: string) => Promise<object> }}
 */
export function useModelList({ withUsage = false } = {}) {
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [usage, setUsage] = useState(null);

  const load = useCallback(async () => {
    const llm = llmApi();
    if (!llm) return;
    try {
      const res = llm.listModels ? await llm.listModels("anthropic") : null;
      setModels((res && res.models) || []);
    } catch (_e) {
      setModels([]);
    }
    try {
      if (llm.modelListStatus) setStatus((await llm.modelListStatus()) || null);
    } catch (_e) {
      setStatus(null);
    }
    try {
      // A scan of every dashboard: only where it's shown (Settings › AI).
      if (withUsage && llm.modelUsage) {
        setUsage((await llm.modelUsage()) || null);
      }
    } catch (_e) {
      setUsage(null);
    }
  }, [withUsage]);

  useEffect(() => {
    load();
    const llm = llmApi();
    const id =
      llm && llm.onModelListChanged
        ? llm.onModelListChanged(() => load())
        : null;
    return () => {
      if (id != null && llm && llm.removeStreamListener) {
        llm.removeStreamListener(id);
      }
    };
  }, [load]);

  const check = useCallback(async () => {
    const llm = llmApi();
    if (!llm || !llm.checkModelList) return;
    setChecking(true);
    try {
      await llm.checkModelList();
    } finally {
      setChecking(false);
      await load();
    }
  }, [load]);

  const seen = useCallback(async () => {
    const llm = llmApi();
    if (!llm || !llm.modelListSeen) return;
    await llm.modelListSeen();
    await load();
  }, [load]);

  const move = useCallback(
    async (from, to = null, opts = {}) => {
      const llm = llmApi();
      if (!llm || !llm.moveRetiredModel) return null;
      const res = await llm.moveRetiredModel(from, to, opts);
      await load();
      return res;
    },
    [load],
  );

  return { models, status, checking, usage, check, seen, move };
}

import { useEffect, useState } from "react";
import { checkStats, reviewerIds } from "./checkCost";

const api = () => (typeof window !== "undefined" ? window.mainApi : null);

/**
 * useCheckStats — what a bot's checks took on its recent jobs (DASH-127):
 * its team's jobs, and the runs of the bots that review for it. Loaded
 * once when the checks window opens; `{}` until then or without the APIs.
 *
 * @param {object} bot
 * @returns {Object<string, { ms?: number, usd?: number }>} by step id
 */
export function useCheckStats(bot) {
  const [stats, setStats] = useState({});
  const botId = bot ? bot.id : null;
  const workspaceId = bot ? bot.workspaceId : null;
  useEffect(() => {
    const m = api();
    const goals = m && m.goals;
    const bots = m && m.bots;
    if (!botId || !goals || typeof goals.list !== "function") return undefined;
    let alive = true;
    (async () => {
      try {
        const list =
          workspaceId === null || workspaceId === undefined
            ? []
            : (await goals.list(workspaceId)) || [];
        const runsByBot = {};
        if (bots && typeof bots.getRuns === "function") {
          for (const id of reviewerIds(bot && bot.checks)) {
            runsByBot[id] = (await bots.getRuns(id, 50)) || [];
          }
        }
        if (alive) setStats(checkStats(list, botId, runsByBot));
      } catch (_e) {
        // Only the cost lines need it: they say "not known yet".
      }
    })();
    return () => {
      alive = false;
    };
    // Once per window: the checks it had when it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId, workspaceId]);
  return stats;
}

export default useCheckStats;

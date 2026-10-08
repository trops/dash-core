import { useEffect, useState } from "react";
import { getBotEmitters } from "./eventCatalog";

/**
 * A dashboard's bots as listener sources (bot-teams TEAM-012) — the same
 * list in Dashboard Config › Listeners and a widget's Configure › Listeners.
 * Null until loaded (or while `enabled` is false), so bot wiring isn't
 * judged before the bots are known; [] when they can't be read.
 *
 * @param {string|number|null} workspaceId
 * @param {boolean} [enabled]
 */
export function useBotEmitters(workspaceId, enabled = true) {
  const [botEmitters, setBotEmitters] = useState(null);
  useEffect(() => {
    const bots = typeof window !== "undefined" && window.mainApi?.bots;
    if (!enabled || !bots || !bots.list || workspaceId == null) {
      return undefined;
    }
    let alive = true;
    Promise.all([
      bots.list(),
      bots.listToolSources ? bots.listToolSources() : Promise.resolve([]),
    ])
      .then(([list, sources]) => {
        if (alive) setBotEmitters(getBotEmitters(list, sources, workspaceId));
      })
      .catch(() => {
        if (alive) setBotEmitters([]);
      });
    return () => {
      alive = false;
    };
  }, [enabled, workspaceId]);
  return botEmitters;
}

import { useEffect, useState } from "react";
import { teamSetupStatus } from "../../utils/teamSetupStatus";
import { lastSetupCheck, onSetupChanged } from "./teamSetupStore";

/**
 * useTeamSetups / useTeamSetup — each team's setup status (DASH-119):
 * teamSetupStatus over its bots (as saved, so a bot's save shows at once),
 * its team settings (read once, and again when they're saved) and the last
 * Check setup kept in teamSetupStore.
 */

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

const keyOf = (id) =>
  id === null || id === undefined || id === "" ? null : String(id);

async function readTeam(workspaceId) {
  const b = api();
  if (!b) return null;
  try {
    if (b.getTeamValues) return (await b.getTeamValues(workspaceId)) || null;
    if (b.getTeamSettings)
      return (await b.getTeamSettings(workspaceId)) || null;
  } catch (_e) {
    return null;
  }
  return null;
}

/**
 * @param {{ workspaceId, bots: object[] }[]} entries  one per team
 * @returns {Map<string, object>} workspaceId (as a string) → status
 */
export function useTeamSetups(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && keyOf(e.workspaceId) !== null,
  );
  const idsKey = list.map((e) => keyOf(e.workspaceId)).join("|");
  const [teams, setTeams] = useState({});
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let alive = true;
    const ids = idsKey ? idsKey.split("|") : [];
    const b = api();
    // Nothing to read with (an older preload, a test): the bots alone.
    const canRead = !!(b && (b.getTeamValues || b.getTeamSettings));
    const load = (only) => {
      if (!canRead) return;
      for (const id of ids) {
        if (only && only !== id) continue;
        readTeam(id).then((t) => {
          if (!alive) return;
          setTeams((prev) =>
            prev[id] === t || (!t && !prev[id]) ? prev : { ...prev, [id]: t },
          );
        });
      }
    };
    load(null);
    const off = onSetupChanged((id) => {
      if (!alive) return;
      setSeq((n) => n + 1);
      if (id && ids.includes(id)) load(id);
    });
    return () => {
      alive = false;
      off();
    };
  }, [idsKey]);

  // Worked out each render: cheap, and always the bots as saved now.
  void seq;
  const out = new Map();
  for (const e of list) {
    const id = keyOf(e.workspaceId);
    out.set(
      id,
      teamSetupStatus({
        bots: e.bots || [],
        team: teams[id] || null,
        check: lastSetupCheck(id),
      }),
    );
  }
  return out;
}

/** One team's status (ready when there's no team). */
export function useTeamSetup(workspaceId, bots) {
  const statuses = useTeamSetups(
    keyOf(workspaceId) === null ? [] : [{ workspaceId, bots }],
  );
  return statuses.get(keyOf(workspaceId)) || teamSetupStatus({ bots: [] });
}

export default useTeamSetup;

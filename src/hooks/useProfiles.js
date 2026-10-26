import { useCallback, useEffect, useState } from "react";

/**
 * The profiles on this computer and the active one (dash-profiles PRD),
 * for "Remove from this profile" in the Dashboards and Bots pages. With
 * only Default, `hasProfiles` is false and nothing profile-related shows.
 *
 * `otherHolders(kind, id)` names the other profiles that hold an item, so
 * a removal can say where it stays.
 */
export function useProfiles(appId) {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);

  const reload = useCallback(async () => {
    const api = window.mainApi?.profiles;
    if (!appId || !api) return;
    try {
      const res = await api.list(appId);
      if (!res || !res.success) return;
      setProfiles(res.profiles || []);
      setActiveId(res.activeProfileId);
    } catch (_e) {
      // No profiles API (older host): behave as Default only.
    }
  }, [appId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const active = profiles.find((p) => p.id === activeId) || null;
  const hasProfiles = profiles.length > 1;

  const otherHolders = (kind, id) =>
    profiles
      .filter(
        (p) =>
          p.id !== activeId &&
          ((p.items && p.items[kind]) || []).includes(String(id)),
      )
      .map((p) => p.name);

  /** Take an item out of the active profile only; it stays on the computer. */
  const removeFromActive = async (kind, id) => {
    const res = await window.mainApi?.profiles?.setMembership?.(
      appId,
      activeId,
      kind,
      id,
      false,
    );
    await reload();
    return res || { success: false, error: "Profiles aren't available." };
  };

  return { profiles, active, hasProfiles, otherHolders, removeFromActive };
}

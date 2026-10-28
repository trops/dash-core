import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useProfileSync — the out-of-sync check for profiles kept in the
 * account (dash-profiles step 2, S3). Asks the main process to compare
 * each linked profile here with the account; runs when the app starts,
 * after a sign-in, and on every manual "Check for updates".
 *
 * Returns the profiles that need something (`profileUpdates`: state
 * "account-newer" | "local-changed" | "both"), whether a check is
 * running, whether one has finished, and `recheck`. A check that can't
 * run (signed out, registry unreachable) shows nothing.
 */
export function useProfileSync(appId) {
  const [profileUpdates, setProfileUpdates] = useState([]);
  const [isChecking, setIsChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  const recheck = useCallback(async () => {
    const api = window.mainApi?.profiles?.syncStatus;
    if (!appId || typeof api !== "function") {
      setHasChecked(true);
      return;
    }
    setIsChecking(true);
    try {
      const res = await api(appId);
      const rows =
        res && res.success && Array.isArray(res.profiles) ? res.profiles : [];
      setProfileUpdates(
        rows.filter((p) => p && p.state && p.state !== "in-sync"),
      );
    } catch (_e) {
      setProfileUpdates([]);
    } finally {
      setIsChecking(false);
      setHasChecked(true);
    }
  }, [appId]);

  const checkedRef = useRef(false);
  useEffect(() => {
    if (checkedRef.current || !appId) return;
    checkedRef.current = true;
    recheck();
  }, [appId, recheck]);

  // Signing in links this computer's profiles to an account: check again.
  useEffect(() => {
    const onAuthChanged = () => recheck();
    window.addEventListener("dash:registry-auth-changed", onAuthChanged);
    return () =>
      window.removeEventListener("dash:registry-auth-changed", onAuthChanged);
  }, [recheck]);

  return { profileUpdates, isChecking, hasChecked, recheck };
}

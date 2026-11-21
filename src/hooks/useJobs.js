import { useCallback, useEffect, useRef, useState } from "react";
import { jobCounts } from "../Components/Jobs/jobText";

/**
 * useJobs — jobs (DASH-31): each chain of work through a team lead, read
 * from the main process (window.mainApi.bots) and kept fresh on its
 * jobs-changed broadcast.
 *
 * - useJobs(workspaceId?, { open, limit, skip }) → { jobs, loading, refresh }:
 *   every dashboard's, or one's; `skip` reads nothing (no dashboard yet).
 * - useJobCounts() → { running, needsYou, … } across every dashboard.
 * - useJob(jobId)  → { job, refresh }: one job with what each bot said.
 */

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

/**
 * Calls fn with each jobs change ({ jobId, workspaceId, status }); returns
 * an unsubscribe. The preload hands listeners the payload alone.
 */
export function onJobsChanged(fn) {
  const api = botsApi();
  if (!api || typeof api.onJobsChanged !== "function") return () => {};
  let id = null;
  try {
    id = api.onJobsChanged((payload) => fn(payload || {}));
  } catch (_e) {
    return () => {};
  }
  return () => {
    try {
      if (typeof api.removeListener === "function") api.removeListener(id);
    } catch (_e) {
      // already gone
    }
  };
}

export function useJobs(
  workspaceId = null,
  { open = false, limit = null, skip = false } = {},
) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const api = botsApi();
    if (skip || !api || typeof api.listJobs !== "function") {
      setJobs([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    try {
      const list = await api.listJobs(
        workspaceId == null ? null : workspaceId,
        { open, limit },
      );
      if (mine !== seq.current) return;
      setJobs(Array.isArray(list) ? list : []);
    } catch (_e) {
      // keep the last list on a transient IPC error
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [workspaceId, open, limit, skip]);

  // Another dashboard: never show the last one's jobs meanwhile.
  useEffect(() => {
    setJobs([]);
    setLoading(true);
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    if (skip) return undefined;
    return onJobsChanged((p) => {
      if (
        workspaceId == null ||
        p.workspaceId == null ||
        String(p.workspaceId) === String(workspaceId)
      ) {
        refresh();
      }
    });
  }, [refresh, workspaceId, skip]);

  return { jobs, loading, refresh };
}

/** How many jobs are running and need you, on every dashboard. */
export function useJobCounts() {
  const { jobs } = useJobs(null, { open: true });
  return jobCounts(jobs);
}

/** One job with what each bot said, kept fresh. */
export function useJob(jobId) {
  const [job, setJob] = useState(null);
  const refresh = useCallback(async () => {
    const api = botsApi();
    if (!jobId || !api || typeof api.getJob !== "function") {
      setJob(null);
      return;
    }
    try {
      setJob((await api.getJob(jobId)) || null);
    } catch (_e) {
      // keep the last one
    }
  }, [jobId]);
  useEffect(() => {
    refresh();
    if (!jobId) return undefined;
    return onJobsChanged((p) => {
      if (!p.jobId || p.jobId === jobId) refresh();
    });
  }, [refresh, jobId]);
  return { job, refresh };
}

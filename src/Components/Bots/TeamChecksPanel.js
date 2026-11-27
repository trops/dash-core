import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Button3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * Repo checks on a team's page (DASH-110), step 3 of its Set up checklist
 * (DASH-120):
 *   - each repo that has .dash/checks, and which;
 *   - "Set up checks" for each of the team's repos with none: Dash drafts
 *     setup and validate from the repo's own setup and CI, tries them in a
 *     fresh clone, and opens one PR;
 *   - the team's own checks: a PR still open, or one closed without
 *     merging, where you keep it as a team check or remove it.
 *
 *   useRepoChecks(workspaceId)  the data and its actions
 *   RepoChecksRows              the rows, given useRepoChecks' result
 *   repoChecksSummary(data)     { shown, missing, closed } for the step
 */

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

export const STATE_TEXT = {
  "pr-open": "PR open: this team's copy runs until it's merged",
  "pr-closed": "Its PR was closed without merging",
  team: "This team only",
};

/** What the checklist's step needs: shown when the team has repos. */
export function repoChecksSummary(data) {
  const repos = (data && data.repos) || [];
  const withChecks = (data && data.withChecks) || [];
  const checks = (data && data.checks) || [];
  return {
    shown: repos.length + withChecks.length + checks.length > 0,
    missing: repos.length,
    closed: checks.filter((c) => c && c.state === "pr-closed").length,
  };
}

export function useRepoChecks(workspaceId) {
  const [repos, setRepos] = useState([]);
  const [withChecks, setWithChecks] = useState([]);
  const [checks, setChecks] = useState([]);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const current = useRef(workspaceId);
  current.current = workspaceId;

  const load = useCallback(() => {
    const api = botsApi();
    if (!api || workspaceId == null) return;
    if (api.reposWithoutChecks) {
      Promise.resolve(api.reposWithoutChecks(workspaceId))
        .then((r) => {
          if (current.current !== workspaceId) return;
          setRepos((r && r.repos) || []);
          setWithChecks((r && r.withChecks) || []);
        })
        .catch(() => {});
    }
    if (api.teamChecks) {
      Promise.resolve(api.teamChecks(workspaceId))
        .then(
          (r) =>
            current.current === workspaceId && setChecks((r && r.checks) || []),
        )
        .catch(() => {});
    }
  }, [workspaceId]);
  useEffect(() => {
    setRepos([]);
    setWithChecks([]);
    setChecks([]);
    setNote(null);
    load();
  }, [load]);

  const act = async (what, fn) => {
    setBusy(what);
    setNote(null);
    try {
      const r = await fn();
      if (r && r.error) throw new Error(r.error);
      return r;
    } catch (e) {
      setNote((e && e.message) || String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const setUp = (key) =>
    act(`setup:${key}`, async () => {
      const r = await botsApi().setUpRepoChecks(workspaceId, key);
      if (r && r.pr)
        setNote(
          `Opened ${r.pr.url}: setup and validate, tried in a fresh clone.`,
        );
      load();
      return r;
    });

  const resolve = (name, choice) =>
    act(`${choice}:${name}`, async () => {
      const r = await botsApi().resolveTeamCheck(workspaceId, name, choice);
      load();
      return r;
    });

  return { repos, withChecks, checks, busy, note, setUp, resolve, load };
}

export const RepoChecksRows = ({ data }) => {
  const { muted } = useConfigTokens();
  if (!data) return null;
  const { repos, withChecks, checks, busy, note, setUp, resolve } = data;
  return (
    <div className="flex flex-col gap-2" data-testid="team-checks-panel">
      {(withChecks || []).map((r) => (
        <div
          key={`has:${r.key}`}
          className="text-sm"
          data-testid={`repo-has-checks-${r.key}`}
        >
          {`${r.slug} · ${r.checks.length} check${r.checks.length === 1 ? "" : "s"}${
            r.checks.length ? ` (${r.checks.join(", ")})` : ""
          }`}
        </div>
      ))}
      {repos.map((r) => (
        <div
          key={r.key}
          className="flex flex-row items-center gap-3"
          data-testid={`setup-banner-${r.key}`}
        >
          <span className="flex-1 min-w-0 text-sm">
            {`${r.slug} has no checks yet. Dash can draft setup and validate from its own setup and CI, try them, and open a PR.`}
          </span>
          <Button
            title={busy === `setup:${r.key}` ? "Setting up…" : "Set up checks"}
            size="sm"
            onClick={busy ? undefined : () => setUp(r.key)}
          />
        </div>
      ))}
      {checks.map((c) => (
        <div
          key={c.name}
          className="flex flex-row items-center gap-3"
          data-testid={`team-check-${c.name}`}
        >
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-sm">{`.dash/checks/${c.file}`}</span>
            <span className={`text-xs ${muted}`}>
              {STATE_TEXT[c.state] || c.state}
              {c.pr && c.pr.url ? ` · ${c.pr.url}` : ""}
            </span>
          </span>
          {c.state === "pr-closed" ? (
            <>
              <Button3
                title="Keep as a team check"
                size="sm"
                onClick={busy ? undefined : () => resolve(c.name, "keep")}
              />
              <Button3
                title="Remove"
                size="sm"
                onClick={busy ? undefined : () => resolve(c.name, "remove")}
              />
            </>
          ) : null}
        </div>
      ))}
      {note ? <span className="text-xs">{note}</span> : null}
    </div>
  );
};

export default RepoChecksRows;

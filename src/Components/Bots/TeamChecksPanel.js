import React, { useEffect, useRef, useState } from "react";
import { Button, Button3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * TeamChecksPanel (DASH-110) — on a team's page:
 *   - "Set up checks" for each of the team's repos with no .dash/checks:
 *     Dash drafts setup and validate from the repo's own setup and CI,
 *     tries them in a fresh clone, and opens one PR;
 *   - the team's own checks: a PR still open, or one closed without
 *     merging, where you keep it as a team check or remove it.
 *
 * DASH-130: always shown, with a line per repo ("dash-core: 2 checks"),
 * and PR links open in the browser.
 */

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

export const STATE_TEXT = {
  "pr-open": "PR open: this team's copy runs until it's merged",
  "pr-closed": "Its PR was closed without merging",
  team: "This team only",
};

/** A repo's short name: "dash-core" for "trops/dash-core". */
export function repoName(slug) {
  const s = String(slug || "");
  return s.slice(s.lastIndexOf("/") + 1) || s;
}

/** A repo's line in the panel: "dash-core: 2 checks". */
export function repoChecksLine(repo) {
  const name = repoName(repo && (repo.slug || repo.key));
  const n = repo && repo.count;
  if (n == null) return `${name}: Dash can't read its checks`;
  if (n === 0) return `${name}: no checks yet`;
  return `${name}: ${n} check${n === 1 ? "" : "s"}`;
}

/**
 * The panel's repo lines: every repo with its count, each without checks
 * flagged for its Set up button. `all` is missing from an older main
 * process: then only the repos without checks are known.
 */
export function repoLines(result) {
  const without = new Set(
    ((result && result.repos) || []).map((r) => r && r.key),
  );
  const all =
    result && Array.isArray(result.all)
      ? result.all
      : ((result && result.repos) || []).map((r) => ({ ...r, count: 0 }));
  return all
    .filter((r) => r && r.key != null)
    .map((r) => ({ ...r, needsSetup: without.has(r.key) }));
}

const openUrl = (url) => {
  const shell = typeof window !== "undefined" && window.mainApi?.shell;
  if (shell && shell.openExternal) shell.openExternal(url);
};

const PrLink = ({ url, className = "" }) => (
  <a
    href={url}
    className={`underline ${className}`}
    onClick={(e) => {
      e.preventDefault();
      openUrl(url);
    }}
  >
    {url}
  </a>
);

export const TeamChecksPanel = ({ workspaceId }) => {
  const { muted, hairline, accent } = useConfigTokens();
  const [repos, setRepos] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [checks, setChecks] = useState([]);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const current = useRef(workspaceId);
  current.current = workspaceId;

  const load = () => {
    const api = botsApi();
    if (!api || workspaceId == null) return;
    if (api.reposWithoutChecks) {
      Promise.resolve(api.reposWithoutChecks(workspaceId))
        .then((r) => {
          if (current.current !== workspaceId) return;
          setRepos(repoLines(r));
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    }
    if (api.teamChecks) {
      Promise.resolve(api.teamChecks(workspaceId))
        .then(
          (r) =>
            current.current === workspaceId && setChecks((r && r.checks) || []),
        )
        .catch(() => {});
    }
  };
  useEffect(load, [workspaceId]);

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
        setNote({
          url: r.pr.url,
          text: ": setup and validate, tried in a fresh clone.",
        });
      load();
      return r;
    });

  const resolve = (name, choice) =>
    act(`${choice}:${name}`, async () => {
      const r = await botsApi().resolveTeamCheck(workspaceId, name, choice);
      load();
      return r;
    });

  if (workspaceId == null) return null;
  return (
    <section
      aria-label="Checks"
      data-testid="team-checks-panel"
      className={`flex flex-col gap-2 rounded-xl border px-4 py-3 ${hairline}`}
    >
      <span className="text-sm font-semibold">Checks</span>
      {loaded && !repos.length && !checks.length ? (
        <span className={`text-xs ${muted}`} data-testid="team-checks-none">
          This team has no repos to check yet.
        </span>
      ) : null}
      {repos.map((r) => (
        <div
          key={r.key}
          className="flex flex-row items-center gap-3"
          data-testid={`repo-checks-${r.key}`}
        >
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-sm">{repoChecksLine(r)}</span>
            {r.needsSetup ? (
              <span
                className={`text-xs ${muted}`}
                data-testid={`setup-banner-${r.key}`}
              >
                Dash can draft setup and validate from its own setup and CI, try
                them, and open a PR.
              </span>
            ) : null}
          </span>
          {r.needsSetup ? (
            <Button
              title={
                busy === `setup:${r.key}` ? "Setting up…" : "Set up checks"
              }
              size="sm"
              onClick={busy ? undefined : () => setUp(r.key)}
            />
          ) : null}
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
              {c.pr && c.pr.url ? (
                <>
                  {" · "}
                  <PrLink url={c.pr.url} className={accent} />
                </>
              ) : null}
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
      {note ? (
        <span className="text-xs" data-testid="team-checks-note">
          {typeof note === "string" ? (
            note
          ) : (
            <>
              {"Opened "}
              <PrLink url={note.url} className={accent} />
              {note.text}
            </>
          )}
        </span>
      ) : null}
    </section>
  );
};

export default TeamChecksPanel;

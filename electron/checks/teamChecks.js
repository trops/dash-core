/**
 * teamChecks.js — checks kept on a team, and the PRs that put them in a
 * repo (DASH-110).
 *
 * Saving a check "to the repo" doesn't wait for the PR: the step is added
 * at once by name ({ kind: "repo", name }), and the draft is kept as a
 * team check. Until the repo has the file, the team copy runs:
 *
 *   pr-open    the PR is open: the team copy runs, the step says "PR open"
 *   (merged)   the repo's file wins: the team copy is dropped
 *   pr-closed  the PR was closed unmerged: the user keeps it as a team
 *              check, or removes it
 *   team       saved for this team only: it always runs from here
 *
 * Kept in the team's settings: teamChecks[name] = { file, code, summary,
 * state, pr?: { url, number, repo }, savedAt }.
 */
"use strict";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const STATES = ["pr-open", "pr-closed", "team"];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A team's check by name ({ kind: "repo", name }), or null. */
function teamCheckOf(teamSettings, name) {
  const all =
    (teamSettings &&
      isObj(teamSettings.teamChecks) &&
      teamSettings.teamChecks) ||
    {};
  const c = all[name];
  if (!isObj(c) || typeof c.file !== "string" || typeof c.code !== "string")
    return null;
  return { name, ...c };
}

/** A team check, cleaned for saving. */
function cleanTeamCheck(c) {
  if (!isObj(c)) return null;
  const file = String(c.file || "");
  // A dash-check recipe drafted on Add check (DASH-133): name.check.json.
  if (!NAME_RE.test(file) || !/\.(sh|js|cjs|mjs|py)$|\.check\.json$/.test(file))
    return null;
  if (
    typeof c.code !== "string" ||
    !c.code.trim() ||
    c.code.length > 256 * 1024
  )
    return null;
  return {
    file,
    code: c.code,
    summary: String(c.summary || "").slice(0, 500),
    state: STATES.includes(c.state) ? c.state : "team",
    ...(isObj(c.pr) && c.pr.url
      ? {
          pr: {
            url: String(c.pr.url),
            number: Number(c.pr.number) || null,
            repo: String(c.pr.repo || ""),
          },
        }
      : {}),
    savedAt: c.savedAt || new Date().toISOString(),
  };
}

async function gh(fetch, token, method, p, body) {
  try {
    const res = await fetch(`https://api.github.com/${p}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try {
      json = await res.json();
    } catch (_e) {
      json = null;
    }
    return { code: res.status, body: json };
  } catch (e) {
    return { code: 0, body: null, error: (e && e.message) || String(e) };
  }
}

/**
 * Open one PR that adds files to a repo: a branch from its base, a commit
 * per file, then the PR. Through the GitHub API with the bot's token.
 * @param {{ slug: "owner/repo", base?: string, branch: string,
 *           files: { [path]: string }, title: string, body?: string,
 *           token: string, fetch?: Function }} p
 * @returns {Promise<{ url, number, branch } | { error }>}
 */
async function openFilesPr({
  slug,
  base = null,
  branch,
  files,
  title,
  body = "",
  token,
  fetch: f = null,
}) {
  const doFetch = f || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return { error: "Dash can't reach GitHub from here" };
  if (!token)
    return {
      error: "No GitHub provider is signed in: give a bot on the team one",
    };
  const repo = await gh(doFetch, token, "GET", `repos/${slug}`);
  if (repo.code !== 200) {
    return {
      error: `The GitHub token can't read ${slug} (HTTP ${repo.code}): add the repo to it`,
    };
  }
  const baseBranch = base || (repo.body && repo.body.default_branch) || "main";
  const ref = await gh(
    doFetch,
    token,
    "GET",
    `repos/${slug}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
  );
  const sha = ref.body && ref.body.object && ref.body.object.sha;
  if (ref.code !== 200 || !sha)
    return { error: `${slug} has no branch ${baseBranch} (HTTP ${ref.code})` };
  const made = await gh(doFetch, token, "POST", `repos/${slug}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha,
  });
  if (made.code !== 201) {
    return {
      error:
        made.code === 403 || made.code === 404
          ? `The GitHub token can't push to ${slug} (HTTP ${made.code}): give it write access to Contents`
          : `Dash couldn't make the branch ${branch} on ${slug} (HTTP ${made.code})`,
    };
  }
  for (const [p, content] of Object.entries(files)) {
    const put = await gh(
      doFetch,
      token,
      "PUT",
      `repos/${slug}/contents/${p.split("/").map(encodeURIComponent).join("/")}`,
      {
        message: `Add ${p}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch,
      },
    );
    if (put.code !== 201 && put.code !== 200) {
      return { error: `Dash couldn't add ${p} to ${slug} (HTTP ${put.code})` };
    }
  }
  const pr = await gh(doFetch, token, "POST", `repos/${slug}/pulls`, {
    title,
    head: branch,
    base: baseBranch,
    body,
  });
  if (pr.code !== 201 || !pr.body) {
    return {
      error:
        pr.code === 403
          ? `The GitHub token can't open PRs on ${slug}: give it write access to Pull requests`
          : `Dash couldn't open the PR on ${slug} (HTTP ${pr.code})`,
    };
  }
  return {
    url: pr.body.html_url,
    number: pr.body.number,
    branch,
    base: baseBranch,
  };
}

/** A PR's state: "open", "merged" or "closed" (or { error }). */
async function prState({ slug, number, token, fetch: f = null }) {
  const doFetch = f || (typeof fetch === "function" ? fetch : null);
  const res = await gh(doFetch, token, "GET", `repos/${slug}/pulls/${number}`);
  if (res.code !== 200 || !res.body)
    return { error: `Can't read PR #${number} on ${slug} (HTTP ${res.code})` };
  if (res.body.merged || res.body.merged_at) return { state: "merged" };
  return { state: res.body.state === "open" ? "open" : "closed" };
}

module.exports = { teamCheckOf, cleanTeamCheck, openFilesPr, prState, STATES };

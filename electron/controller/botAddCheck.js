/**
 * botAddCheck.js — the Add check screen and "Set up checks" (DASH-110),
 * the controller's side. Each takes the botController (`ctl`) and does one
 * thing; botController's methods call them.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  suggestChecks,
  draftPrompt,
  parseDraft,
  tryDraft,
  draftRepoChecks,
  checkNameOf,
} = require("../checks/addCheck");
const {
  teamCheckOf,
  cleanTeamCheck,
  openFilesPr,
  prState,
} = require("../checks/teamChecks");
const { teamRepos } = require("../bots/preflight");
const { isLead } = require("../bots/teamLeads");
const { isOnTeam } = require("../bots/teams");
const { lastJsonObject } = require("../bots/answerJson");

const CHECKS_DIR = ".dash/checks";

async function gh(ctl, token, p) {
  const doFetch = ctl._preflightFetch || fetch;
  try {
    const res = await doFetch(`https://api.github.com/${p}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    let body = null;
    try {
      body = await res.json();
    } catch (_e) {
      body = null;
    }
    return { code: res.status, body };
  } catch (e) {
    return { code: 0, body: null };
  }
}

/** A GitHub token from any bot on the team (for reading and PRs). */
async function teamToken(ctl, workspaceId) {
  for (const b of ctl._store.list().filter((x) => isOnTeam(x, workspaceId))) {
    try {
      const t = await ctl._gitTokenFor(b);
      if (t) return t;
    } catch (_e) {
      // The next bot's, then.
    }
  }
  return null;
}

/** The repo checks each of a team's repos has on its default branch. */
async function repoChecksOf(ctl, workspaceId, token) {
  const team = ctl._store.getTeamSettings(workspaceId) || {};
  const out = [];
  for (const r of teamRepos(team)) {
    const res = await gh(ctl, token, `repos/${r.slug}/contents/${CHECKS_DIR}`);
    out.push({
      ...r,
      checks:
        res.code === 200 && Array.isArray(res.body)
          ? res.body.map((e) => e && e.name).filter(Boolean)
          : [],
      hasChecks: res.code === 200,
      readable: res.code === 200 || res.code === 404,
    });
  }
  return out;
}

/** The check names in a repo's .dash/checks listing. */
function checkNamesIn(repo) {
  return [
    ...new Set(
      ((repo && repo.checks) || [])
        // A check's sample inputs and the repo's helpers aren't checks.
        .filter((c) => c !== "helpers" && !/\.(sample|bad)\.json$/.test(c))
        .map(checkNameOf),
    ),
  ];
}

/** Suggested checks for a bot (In repo, Built in, Ships with Dash, Registry). */
async function suggest(ctl, botId) {
  const bot = ctl._store.get(botId);
  if (!bot) return { error: "That bot no longer exists." };
  const team = ctl._store.getTeamSettings(bot.workspaceId) || {};
  const token = await teamToken(ctl, bot.workspaceId);
  const repos = await repoChecksOf(ctl, bot.workspaceId, token);
  const names = [...new Set(repos.flatMap(checkNamesIn))];
  const { packages, builtIns } = ctl.listCheckPackages();
  return {
    suggestions: suggestChecks({
      bot,
      team,
      repoChecks: names,
      packages,
      builtIns,
    }),
    repos: repos.map((r) => ({
      key: r.key,
      slug: r.slug,
      hasChecks: r.hasChecks,
    })),
  };
}

/** The bot's last finished answer, as a check's input (the good sample). */
function lastInput(ctl, bot) {
  const runs = (ctl._store.getRuns(bot.id) || []).filter(
    (r) => r && r.status === "completed" && typeof r.output === "string",
  );
  const last = runs[runs.length - 1];
  if (!last) return null;
  const h = lastJsonObject(last.output) || {};
  return {
    input: { answer: last.output },
    ...(h.item ? { item: h.item } : {}),
    ...(h.workspace ? { workspace: h.workspace } : {}),
  };
}

/** The team's lead drafts a check from the user's words. */
async function draft(ctl, botId, ask) {
  const bot = ctl._store.get(botId);
  if (!bot) return { error: "That bot no longer exists." };
  if (!String(ask || "").trim())
    return { error: "Say what the check should prove." };
  const lead = ctl._store
    .list()
    .find((b) => isLead(b) && isOnTeam(b, bot.workspaceId));
  if (!lead) return { error: "This team has no lead to write it." };
  const sample = lastInput(ctl, bot);
  const record = await ctl._run(lead.id, {
    prompt: draftPrompt(ask, { bot, sample }),
    trigger: "ask",
    via: "add-check",
  });
  if (!record || record.skipped)
    return { error: (record && record.reason) || "The lead didn't answer." };
  const d = parseDraft(record.output);
  if (d.error) return d;
  return { ...d, good: sample };
}

/** Where a bot's check is tried: its first folder, else a temp one. */
function tryFolder(bot) {
  const first = (bot.projects || []).find(
    (p) => typeof p === "string" && path.isAbsolute(p) && fs.existsSync(p),
  );
  return first || fs.mkdtempSync(path.join(os.tmpdir(), "dash-try-check-"));
}

/** Try it: pass on the good input, fail with a reason on the bad one. */
async function tryIt(ctl, botId, d) {
  const bot = ctl._store.get(botId);
  if (!bot) return { error: "That bot no longer exists." };
  const good = (d && d.good) ||
    lastInput(ctl, bot) || { input: { answer: "" } };
  const bad = (d && d.badSample) || { input: { answer: "" } };
  const res = await tryDraft(d, { good, bad, cwd: tryFolder(bot) });
  return {
    ...res,
    good: { ...res.good, sample: good },
    bad: { ...res.bad, sample: bad },
  };
}

/**
 * Save a tried draft: a step on the bot by name, the draft kept as a team
 * check, and, for "repo", a PR that adds it to the repo.
 * @param {{ draft, where: "repo"|"team", repo?: string (its key or slug),
 *           stepName? }} opts
 */
async function save(
  ctl,
  botId,
  {
    draft: d,
    where = "team",
    repo = null,
    stepName = null,
    addStep = true,
  } = {},
) {
  const bot = ctl._store.get(botId);
  if (!bot) return { error: "That bot no longer exists." };
  const tried = await tryIt(ctl, botId, d);
  if (!tried.ok)
    return {
      error: `Try it first: ${tried.problem || "it didn't pass"}`,
      tried,
    };
  const name = checkNameOf(d.file);
  const ws = bot.workspaceId;
  const team = ctl._store.getTeamSettings(ws) || {};
  let pr = null;
  if (where === "repo") {
    const repos = teamRepos(team);
    const r =
      repos.find((x) => x.key === repo || x.slug === repo) ||
      (repos.length === 1 ? repos[0] : null);
    if (!r)
      return {
        error: repos.length
          ? "Which repo? Pick one of the team's repos."
          : "The team has no repos in its tables: save it for this team only.",
      };
    const token = await teamToken(ctl, ws);
    pr = await openFilesPr({
      slug: r.slug,
      branch: `dash/check-${name}-${Date.now().toString(36)}`,
      files: { [`${CHECKS_DIR}/${d.file}`]: d.code },
      title: `Add the ${name} check (.dash/checks/${d.file})`,
      body: [
        `Adds a Dash check, \`.dash/checks/${d.file}\`.`,
        "",
        d.summary || "",
        "",
        "Made from Dash's Add check screen. Until this is merged, the team's own copy runs.",
      ].join("\n"),
      token,
      ...(ctl._preflightFetch ? { fetch: ctl._preflightFetch } : {}),
    });
    if (pr.error) return pr;
    pr = { url: pr.url, number: pr.number, repo: r.slug };
  }
  const entry = cleanTeamCheck({
    file: d.file,
    code: d.code,
    summary: d.summary,
    state: pr ? "pr-open" : "team",
    ...(pr ? { pr } : {}),
  });
  ctl._store.setTeamSettings(ws, {
    teamChecks: { ...((team && team.teamChecks) || {}), [name]: entry },
  });
  const step = {
    kind: "check",
    name: stepName || `${name} passes`,
    check: { kind: "repo", name },
  };
  // The checks window adds the step to its own draft, and saves it.
  if (addStep === false)
    return { ok: true, name, pr, state: entry.state, step };
  const steps = ((bot.checks && bot.checks.steps) || []).filter(
    (s) =>
      !(
        s &&
        s.kind === "check" &&
        s.check &&
        s.check.kind === "repo" &&
        s.check.name === name
      ),
  );
  steps.push({ id: `step_${name}_${Date.now().toString(36)}`, ...step });
  ctl.save({
    ...bot,
    checks: {
      onFail: "retry",
      maxTries: 3,
      handsOn: "answer",
      ...(bot.checks || {}),
      steps,
    },
  });
  return { ok: true, name, pr, state: entry.state, step };
}

/** The team's checks, with each open PR's state brought up to date. */
async function refresh(ctl, workspaceId) {
  const team = ctl._store.getTeamSettings(workspaceId) || {};
  const all = { ...((team && team.teamChecks) || {}) };
  const token = await teamToken(ctl, workspaceId);
  let changed = false;
  for (const [name, c] of Object.entries(all)) {
    if (!c || c.state !== "pr-open" || !c.pr || !c.pr.number) continue;
    const s = await prState({
      slug: c.pr.repo,
      number: c.pr.number,
      token,
      ...(ctl._preflightFetch ? { fetch: ctl._preflightFetch } : {}),
    });
    if (s.state === "merged") {
      // The repo's file wins.
      delete all[name];
      changed = true;
    } else if (s.state === "closed") {
      all[name] = { ...c, state: "pr-closed" };
      changed = true;
    }
  }
  if (changed) ctl._store.setTeamSettings(workspaceId, { teamChecks: all });
  return {
    checks: Object.entries(all).map(([name, c]) => ({
      name,
      file: c.file,
      summary: c.summary,
      state: c.state,
      pr: c.pr || null,
    })),
  };
}

/** A closed PR's check: kept for this team, or removed (and its steps). */
function resolve(ctl, workspaceId, name, choice) {
  const team = ctl._store.getTeamSettings(workspaceId) || {};
  const all = { ...((team && team.teamChecks) || {}) };
  if (!all[name]) return { error: `The team has no check "${name}"` };
  if (choice === "keep") {
    all[name] = { ...all[name], state: "team" };
    ctl._store.setTeamSettings(workspaceId, { teamChecks: all });
    return { ok: true, state: "team" };
  }
  if (choice !== "remove") return { error: 'Choose "keep" or "remove".' };
  delete all[name];
  ctl._store.setTeamSettings(workspaceId, { teamChecks: all });
  for (const b of ctl._store.list().filter((x) => isOnTeam(x, workspaceId))) {
    const steps = (b.checks && b.checks.steps) || [];
    const kept = steps.filter(
      (s) =>
        !(
          s &&
          s.kind === "check" &&
          s.check &&
          s.check.kind === "repo" &&
          s.check.name === name
        ),
    );
    if (kept.length !== steps.length)
      ctl.save({
        ...b,
        checks: kept.length ? { ...b.checks, steps: kept } : null,
      });
  }
  return { ok: true, removed: true };
}

/**
 * The team's repos that have no .dash/checks yet (the Set up checks
 * banner), and every repo with its check count (DASH-130: the Checks
 * panel's "<repo>: N checks" lines). `count` is null when Dash can't
 * read the repo.
 */
async function reposWithoutChecks(ctl, workspaceId) {
  const token = await teamToken(ctl, workspaceId);
  const repos = await repoChecksOf(ctl, workspaceId, token);
  return {
    repos: repos
      .filter((r) => r.readable && !r.hasChecks)
      .map((r) => ({ key: r.key, slug: r.slug })),
    all: repos.map((r) => ({
      key: r.key,
      slug: r.slug,
      count: r.readable ? checkNamesIn(r).length : null,
    })),
  };
}

/**
 * Set up checks for a repo: setup and validate drafted from its lockfile,
 * package.json scripts and CI workflows, tried in a temporary clone, then
 * one PR. With `dryRun`, it stops before the PR.
 */
async function setUp(ctl, workspaceId, repoKey, { dryRun = false } = {}) {
  const team = ctl._store.getTeamSettings(workspaceId) || {};
  const r = teamRepos(team).find(
    (x) => x.key === repoKey || x.slug === repoKey,
  );
  if (!r) return { error: `The team has no repo "${repoKey}"` };
  const token = await teamToken(ctl, workspaceId);
  const files = {};
  for (const f of [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "requirements.txt",
  ]) {
    const res = await gh(ctl, token, `repos/${r.slug}/contents/${f}`);
    if (res.code === 200 && res.body && res.body.content) {
      files[f] =
        f === "package.json"
          ? Buffer.from(res.body.content, "base64").toString("utf8")
          : "(present)";
    }
  }
  const wf = await gh(ctl, token, `repos/${r.slug}/contents/.github/workflows`);
  for (const e of wf.code === 200 && Array.isArray(wf.body) ? wf.body : []) {
    if (!e || !/\.ya?ml$/.test(e.name)) continue;
    const res = await gh(
      ctl,
      token,
      `repos/${r.slug}/contents/.github/workflows/${encodeURIComponent(e.name)}`,
    );
    if (res.code === 200 && res.body && res.body.content) {
      files[`.github/workflows/${e.name}`] = Buffer.from(
        res.body.content,
        "base64",
      ).toString("utf8");
    }
  }
  const drafted = draftRepoChecks(files);
  if (drafted.error) return drafted;
  // Tried in a temporary clone: setup, then validate.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-setup-checks-"));
  const tried = {};
  try {
    const { gitSignInEnv } = require("../bots/gitSignIn");
    const env = {
      ...process.env,
      ...(token ? gitSignInEnv(token, process.env) : {}),
    };
    const clone = spawnSync(
      "git",
      ["clone", "--depth", "1", `https://github.com/${r.slug}.git`, dir],
      { env, encoding: "utf8", timeout: 5 * 60 * 1000 },
    );
    if (clone.status !== 0)
      return {
        error: `Dash couldn't clone ${r.slug} to try them: ${String(
          clone.stderr || "",
        )
          .trim()
          .slice(-300)}`,
        ...drafted,
      };
    for (const f of ["setup.sh", "validate.sh"]) {
      const p = path.join(dir, "__dash_try_" + f);
      fs.writeFileSync(p, drafted.files[f], { mode: 0o755 });
      const run = spawnSync("bash", [p], {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 20 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
      });
      fs.rmSync(p, { force: true });
      const out = `${run.stdout || ""}${run.stderr || ""}`;
      tried[f] = { pass: run.status === 0, output: out.slice(-3000) };
      if (run.status !== 0) {
        return {
          error: `${f} failed in a clone of ${r.slug}, so no PR was opened: see its output`,
          ...drafted,
          tried,
        };
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (dryRun) return { ok: true, ...drafted, tried };
  const pr = await openFilesPr({
    slug: r.slug,
    branch: `dash/set-up-checks-${Date.now().toString(36)}`,
    files: {
      [`${CHECKS_DIR}/setup.sh`]: drafted.files["setup.sh"],
      [`${CHECKS_DIR}/validate.sh`]: drafted.files["validate.sh"],
    },
    title: "Add Dash checks: setup and validate",
    body: [
      "Adds `.dash/checks/setup.sh` and `.dash/checks/validate.sh`, drafted by Dash from this repo's own setup and CI, and tried in a fresh clone.",
      "",
      ...drafted.notes.map((n) => `- ${n}`),
      "",
      'Bots use them as repo checks ({ kind: "repo", name: "validate" }); `npx -p @trops/dash-core dash-check --ci` runs them by hand.',
    ].join("\n"),
    token,
    ...(ctl._preflightFetch ? { fetch: ctl._preflightFetch } : {}),
  });
  if (pr.error) return { ...pr, ...drafted, tried };
  return {
    ok: true,
    ...drafted,
    tried,
    pr: { url: pr.url, number: pr.number, repo: r.slug },
  };
}

module.exports = {
  suggest,
  draft,
  tryIt,
  save,
  refresh,
  resolve,
  reposWithoutChecks,
  checkNamesIn,
  setUp,
  teamCheck: (ctl, workspaceId, name) =>
    teamCheckOf(ctl._store.getTeamSettings(workspaceId), name),
};

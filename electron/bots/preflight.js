/**
 * preflight.js — a team's setup, checked before a job starts (DASH-108).
 *
 * Deterministic, and each problem says its fix:
 *   setting     a setting a bot uses has no value (or a table no rows)
 *   provider    a provider a bot uses isn't there, or doesn't start
 *   ai-login    the AI a bot runs on (or the user's default) isn't signed
 *               in: an expired or missing login, a refused key (DASH-114)
 *   repo-read   a repo in the team's tables can't be read with the token
 *   repo-push   …or can't be pushed to, when a bot on the team pushes
 *   repo-check  a repo check a step names isn't on a repo's base branch
 *               (and the step has no fallback, and doesn't skip)
 *
 * And warnings, which don't stop a job (strictWarnings, DASH-116):
 *   strict-command  a strict bot's instructions name a shell command that
 *                   isn't in its allowed commands
 *
 * Pure apart from what it's given: the providers, the GitHub token and
 * fetch come in as deps, so the app and the tests run the same code.
 */
"use strict";

const { withTeamValues } = require("./teamValues");
const { pickFile, CHECKS_DIR } = require("../checks/kinds/repo");
const { aiLabel } = require("./aiLogin");
const { strictCommandWarnings } = require("./strictMode");

const REPO_URL_RE =
  /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
// A bot that pushes: its words, or its GitHub tools.
const PUSH_RE = /\bgit\s+push\b/;
const PUSH_TOOLS = [
  "create_pull_request",
  "merge_pull_request",
  "push_files",
  "create_or_update_file",
  "create_branch",
];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** The GitHub repos in a team's tables: { owner, repo, slug, table, key, row }. */
function teamRepos(team) {
  const declared =
    (team && Array.isArray(team.declared) && team.declared) || [];
  const values = (team && isObj(team.values) && team.values) || {};
  const out = [];
  for (const t of declared) {
    if (!t || t.type !== "table") continue;
    const urlCols = (t.columns || []).filter((c) => c && c.type === "url");
    const rows = Array.isArray(values[t.name]) ? values[t.name] : [];
    for (const row of rows) {
      if (!row || !row.key) continue;
      for (const c of urlCols) {
        const m = str(row[c.name]).match(REPO_URL_RE);
        if (!m) continue;
        out.push({
          owner: m[1],
          repo: m[2],
          slug: `${m[1]}/${m[2]}`,
          table: t.name,
          key: row.key,
        });
        break;
      }
    }
  }
  return out;
}

/** Does this bot push (git push, or a GitHub tool that writes)? */
function pushes(bot) {
  const text = [
    bot && bot.instructions,
    JSON.stringify((bot && bot.checks) || null),
  ].join("\n");
  if (PUSH_RE.test(text)) return true;
  const tools = ((bot && bot.providers) || []).flatMap(
    (p) => (p && p.tools) || [],
  );
  const sel = isObj(bot && bot.toolSelections)
    ? Object.values(bot.toolSelections).flat()
    : [];
  return [...tools, ...sel].some((t) => PUSH_TOOLS.includes(t));
}

/**
 * Warnings for a team's strict bots (DASH-116): a command their
 * instructions name that their allowed commands don't cover. They don't
 * stop a job: its run would be refused the command, saying so.
 */
function strictWarnings(bots, team) {
  return (bots || [])
    .filter(Boolean)
    .flatMap((bot) => strictCommandWarnings(bot, team));
}

/** The repo checks a bot's steps name, that need the file. */
function repoChecksOf(bot) {
  const steps =
    (bot &&
      bot.checks &&
      Array.isArray(bot.checks.steps) &&
      bot.checks.steps) ||
    [];
  return steps
    .filter(
      (s) =>
        s &&
        s.kind === "check" &&
        s.check &&
        s.check.kind === "repo" &&
        str(s.check.name) &&
        s.check.from !== "workspace" &&
        !s.check.fallback &&
        s.check.ifMissing !== "skip",
    )
    .map((s) => ({ step: s.name || s.check.name, check: s.check }));
}

function settingProblems(bot, team, home) {
  const { missing } = withTeamValues(bot, team, { home, picks: {} });
  const out = [];
  for (const m of missing || []) {
    // Filled in by the job (a pick, its item or workspace): not setup.
    if (m.reason && m.reason !== "no-rows") continue;
    if (m.reason === "no-rows") {
      out.push({
        kind: "setting",
        bot: bot.name,
        setting: m.name,
        message: `${bot.name} uses the ${m.label} table, which has no rows: add one on the team's page`,
      });
    } else {
      out.push({
        kind: "setting",
        bot: bot.name,
        setting: m.name,
        message: `${bot.name} uses ${m.label && m.label !== m.name ? `${m.label} ({${m.name}})` : `{${m.name}}`}, which has no value: fill it in on the team's page`,
      });
    }
  }
  return out;
}

async function gh(fetch, token, path) {
  try {
    const res = await fetch(`https://api.github.com/${path}`, {
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
    return { code: 0, body: null, error: (e && e.message) || String(e) };
  }
}

/**
 * Check a team's setup.
 * @param {{ bots: object[], team: object|null, home?: string|null }} p
 *   the team's bots (as saved, with their {names}) and its settings
 * @param {{ providerFailures?: (bot) => Promise<{serverName, message}[]>,
 *           aiProviderOf?: (bot) => string|null,
 *           defaultAiProvider?: string|null,
 *           aiLogin?: (providerId) => Promise<{ ok, problem?, fix? }>,
 *           gitToken?: (bot) => Promise<string|null>,
 *           fetch?: Function }} deps
 * @returns {Promise<{ ok: boolean, problems: object[], checked: object }>}
 */
async function preflight(
  { bots = [], team = null, home = null } = {},
  deps = {},
) {
  const problems = [];
  const list = (bots || []).filter(Boolean);
  const seen = new Set();
  const add = (p) => {
    const k = `${p.kind}|${p.message}`;
    if (seen.has(k)) return;
    seen.add(k);
    problems.push(p);
  };

  // Settings.
  for (const bot of list)
    for (const p of settingProblems(bot, team, home)) add(p);

  // Providers.
  if (deps.providerFailures) {
    for (const bot of list) {
      let failed = [];
      try {
        failed = (await deps.providerFailures(bot)) || [];
      } catch (e) {
        failed = [
          {
            serverName: "its providers",
            message: (e && e.message) || String(e),
          },
        ];
      }
      for (const f of failed) {
        add({
          kind: "provider",
          bot: bot.name,
          provider: f.serverName,
          message: `${bot.name}'s provider ${f.serverName} isn't working (${String(f.message || "it didn't start").slice(0, 300)}): fix it on the Providers page`,
        });
      }
    }
  }

  // AI logins (DASH-114): one cheap call per AI provider the bots run on,
  // and the user's default, so an expired login fails here, not mid-job.
  if (deps.aiLogin) {
    const users = new Map();
    const use = (id, who) => {
      if (!id) return;
      if (!users.has(id)) users.set(id, []);
      if (who) users.get(id).push(who);
    };
    if (deps.defaultAiProvider) use(deps.defaultAiProvider, null);
    for (const bot of list) {
      let id = null;
      try {
        id = deps.aiProviderOf ? deps.aiProviderOf(bot) : null;
      } catch (_e) {
        id = null;
      }
      use(id, bot.name);
    }
    for (const [id, who] of users) {
      let res;
      try {
        res = await deps.aiLogin(id);
      } catch (e) {
        // A check that can't run says nothing about the login.
        res = { ok: true, error: (e && e.message) || String(e) };
      }
      if (!res || res.ok) continue;
      const label = aiLabel(id);
      const runs = who.length
        ? `${who.join(", ")} ${who.length === 1 ? "runs" : "run"} on ${label}, which`
        : `Your default AI, ${label},`;
      add({
        kind: "ai-login",
        provider: id,
        bots: who,
        message: `${runs} ${res.problem || "can't sign in"}: ${res.fix || "sign in to it again"}`,
      });
    }
  }

  // Repos: read, push, and the repo checks on their base branches.
  const repos = teamRepos(team);
  const doFetch = deps.fetch || (typeof fetch === "function" ? fetch : null);
  const checked = { repos: repos.length, bots: list.length };
  if (repos.length && doFetch) {
    let token = null;
    if (deps.gitToken) {
      for (const bot of list) {
        try {
          token = await deps.gitToken(bot);
        } catch (_e) {
          token = null;
        }
        if (token) break;
      }
    }
    const who = token
      ? "The GitHub provider's token"
      : "Dash (no bot on the team has a GitHub provider)";
    const anyPush = list.some(pushes);
    // A check the team keeps its own copy of (DASH-110) runs from there.
    const teamCopies = (team && team.teamChecks) || {};
    const withChecks = list
      .map((b) => ({
        bot: b,
        checks: repoChecksOf(b).filter((c) => !teamCopies[c.check.name]),
      }))
      .filter((x) => x.checks.length);
    for (const r of repos) {
      const res = await gh(doFetch, token, `repos/${r.slug}`);
      if (res.code !== 200) {
        add({
          kind: "repo-read",
          repo: r.slug,
          message: res.code
            ? `${who} can't read ${r.slug} (HTTP ${res.code}): ${token ? "add the repo to the token, or check the Repos table's address" : "give a bot on the team a GitHub provider"}`
            : `Dash can't reach GitHub to check ${r.slug}: ${res.error}`,
        });
        continue;
      }
      const perms = (res.body && res.body.permissions) || null;
      if (anyPush && perms && perms.push === false) {
        add({
          kind: "repo-push",
          repo: r.slug,
          message: `${who} can't push to ${r.slug}: add the repo to the token with write access (Contents and Pull requests)`,
        });
      }
      for (const { bot, checks } of withChecks) {
        for (const { step, check } of checks) {
          // The check's base, filled from this repo's row.
          const { bot: filled } = withTeamValues(
            { checks: { steps: [{ kind: "check", check }] } },
            team,
            { home, picks: { [r.table]: r.key } },
          );
          const fc = (filled.checks && filled.checks.steps[0].check) || check;
          const base =
            (str(fc.base) &&
              !/[{}]/.test(fc.base) &&
              fc.base.replace(/^origin\//, "")) ||
            (res.body && res.body.default_branch) ||
            "main";
          const name = str(fc.name);
          const dir = await gh(
            doFetch,
            token,
            `repos/${r.slug}/contents/${CHECKS_DIR}?ref=${encodeURIComponent(base)}`,
          );
          const names =
            dir.code === 200 && Array.isArray(dir.body)
              ? dir.body.map((e) => e && e.name).filter(Boolean)
              : [];
          if (dir.code !== 200 && dir.code !== 404) {
            add({
              kind: "repo-check",
              repo: r.slug,
              bot: bot.name,
              message: `${who} can't read ${r.slug}'s ${CHECKS_DIR} on ${base} (HTTP ${dir.code}), so ${bot.name}'s "${step}" can't be checked`,
            });
            continue;
          }
          if (!pickFile(names, name)) {
            add({
              kind: "repo-check",
              repo: r.slug,
              bot: bot.name,
              message: `${r.slug} has no ${CHECKS_DIR}/${name} on ${base}, which ${bot.name}'s "${step}" runs: add it to the repo, or give the step a fallback`,
            });
          }
        }
      }
    }
  }
  const warnings = strictWarnings(list, team);
  return { ok: problems.length === 0, problems, warnings, checked };
}

/** Problems as the lines a failed job (or the Check setup button) shows. */
function preflightText(problems, warnings = []) {
  const list = problems || [];
  const warn = (warnings || []).length
    ? ["Worth a look:", ...warnings.map((w) => `- ${w.message}`)]
    : [];
  if (!list.length) return ["The team's setup is good.", ...warn].join("\n");
  return [
    `The team's setup has ${list.length} problem${list.length === 1 ? "" : "s"}, so the job didn't start:`,
    ...list.map((p) => `- ${p.message}`),
    ...warn,
  ].join("\n");
}

module.exports = {
  preflight,
  preflightText,
  teamRepos,
  pushes,
  repoChecksOf,
  strictWarnings,
};

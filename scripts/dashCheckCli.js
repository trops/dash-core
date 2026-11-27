#!/usr/bin/env node
/**
 * dashCheckCli.js — `dash-check`: run a repo's Dash checks by hand or in
 * CI (DASH-107, DASH-111), the way Dash runs them for a bot.
 *
 * A thin wrapper (DASH-133): the runner is @trops/dash-check's own CLI, so
 * Dash, CI and a laptop run checks one way. This file adds only what's
 * Dash's:
 *   --guide   prints the checks guide (skills/dash-check-authoring)
 *   --base    runs (or lists) the base branch's copy of .dash/checks, as Dash
 *             does, with the checks running in the repo
 *
 * Usage (in the repo):
 *   npx -p @trops/dash-core dash-check <name>            # run .dash/checks/<name>
 *   npx -p @trops/dash-core dash-check <name> --input f  # with a sample input
 *   npx -p @trops/dash-core dash-check <name> --base     # the base branch's copy
 *   npx -p @trops/dash-core dash-check --list            # what's there
 *   npx -p @trops/dash-core dash-check --ci [a,b]        # every check (or these)
 *   npx -p @trops/dash-core dash-check --guide           # how to write one
 * and everything else @trops/dash-check's CLI does (--list-helpers,
 * --explain, new <name>, --watch, --json).
 *
 * Exit codes: 0 passed, 1 a check failed, 2 bad arguments / no such check.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CHECKS_DIR = ".dash/checks";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SAMPLE = { input: { answer: "" }, item: null, workspace: null };

const lib = () => require("@trops/dash-check/cli");

/** Dash's flags, taken out of argv: { base, guide, cwd, input, ... rest }. */
function parseArgs(argv) {
  const a = {
    base: false,
    guide: false,
    list: false,
    ci: false,
    names: [],
    cwd: process.cwd(),
    input: null,
    timeout: null,
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--base") a.base = true;
    else if (v === "--guide") a.guide = true;
    else {
      a.rest.push(v);
      if (v === "--cwd") {
        a.cwd = path.resolve(argv[i + 1] || ".");
        a.rest.push(argv[++i]);
      } else if (v === "--input" || v === "-i") {
        a.input = argv[i + 1];
        a.rest.push(argv[++i]);
      } else if (v === "--timeout") {
        a.timeout = Number(argv[i + 1]);
        a.rest.push(argv[++i]);
      } else if (v === "--list") a.list = true;
      else if (v === "--ci") {
        a.ci = true;
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          a.names.push(...argv[i + 1].split(",").filter(Boolean));
          a.rest.push(argv[++i]);
        }
      } else if (!v.startsWith("-")) a.names.push(v);
    }
  }
  return a;
}

/** The checks guide, without its skill front matter. */
function guideText() {
  const guide = path.join(
    __dirname,
    "..",
    "skills",
    "dash-check-authoring",
    "SKILL.md",
  );
  return fs.readFileSync(guide, "utf8").replace(/^---[\s\S]*?---\n+/, "");
}

const git = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "buffer" });
  return r.status === 0 ? r.stdout : null;
};

/** The base branch's ref: origin/HEAD's, else origin/main or origin/master. */
function baseRef(cwd) {
  const head = git(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    cwd,
  );
  const refs = [];
  if (head)
    refs.push(
      head
        .toString()
        .trim()
        .replace(/^refs\/remotes\//, ""),
    );
  refs.push("origin/main", "origin/master");
  return (
    refs.find((r) =>
      git(["rev-parse", "--verify", "--quiet", `${r}^{commit}`], cwd),
    ) || null
  );
}

/** Copy the base branch's .dash/checks (all of it) into `dir`. */
function copyTree(cwd, ref, rel, dir) {
  const out = git(["ls-tree", "-r", "--name-only", `${ref}:${rel}`], cwd);
  for (const f of (out ? out.toString().split("\n") : []).filter(Boolean)) {
    const body = git(["show", `${ref}:${rel}/${f}`], cwd);
    if (body == null) continue;
    const dest = path.join(dir, rel, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body, { mode: 0o755 });
  }
}

/**
 * --base: the base branch's checks, run by the library in the repo. They're
 * copied out of git (the work tree isn't touched), and each runs with the
 * repo as its cwd.
 */
async function runBase(a, out) {
  const ref = baseRef(a.cwd);
  if (!ref) {
    out.err("No base branch (origin/HEAD, origin/main or origin/master)");
    return 2;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dash-check-base-"));
  try {
    copyTree(a.cwd, ref, CHECKS_DIR, tmp);
    const cli = lib();
    const checks = cli.listChecks(tmp);
    if (a.list) {
      if (!checks.length) out.log(`No ${CHECKS_DIR} here on ${ref}.`);
      for (const c of checks)
        out.log(`${c.name}\t${CHECKS_DIR}/${c.file}\t${c.type}`);
      return 0;
    }
    for (const n of a.names) {
      if (!NAME_RE.test(n) || n.includes("..")) {
        out.err(`"${n}" can't be a check's name`);
        return 2;
      }
    }
    let given = null;
    if (a.input) {
      try {
        given = JSON.parse(
          fs.readFileSync(path.resolve(a.cwd, a.input), "utf8"),
        );
      } catch (e) {
        out.err(`Can't read ${a.input}: ${e.message}`);
        return 2;
      }
    }
    // The repo's own helpers: the base branch's copies.
    require("@trops/dash-check").loadHelpers({ cwd: tmp });
    const wanted = a.names.length ? a.names : checks.map((c) => c.name);
    if (!wanted.length) {
      out.log(`No ${CHECKS_DIR} on ${ref}: nothing to run.`);
      return 0;
    }
    const fromRepo = path.join(a.cwd, CHECKS_DIR);
    let failed = 0;
    for (const name of wanted) {
      const c =
        checks.find((x) => x.file === name) ||
        checks.find((x) => x.name === name);
      if (!c) {
        out.err(`✗ ${name}: there's no ${CHECKS_DIR}/${name} on ${ref}`);
        if (!a.ci) return 2;
        failed++;
        continue;
      }
      let input = given;
      if (!input && c.sample) {
        try {
          input = JSON.parse(fs.readFileSync(c.sample, "utf8"));
        } catch (_e) {
          input = null;
        }
      }
      // The copy, named from the repo's .dash/checks so the check runs there.
      const file = path.relative(fromRepo, path.join(tmp, CHECKS_DIR, c.file));
      const res = await cli.runEntry(
        { ...c, file },
        { cwd: a.cwd, input: input || SAMPLE, timeoutSec: a.timeout },
      );
      if (res.pass) {
        out.log(`✓ ${name}: ${res.reason}`);
      } else {
        failed++;
        if (res.output) out.log(res.output.split("\n").slice(-30).join("\n"));
        out.log(`✗ ${name}: ${res.reason}`);
      }
    }
    return failed ? 1 : 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The CLI. Gives the exit code.
 * @param {string[]} argv
 * @param {{ log?: Function, err?: Function }} [io]
 */
async function main(argv, { log = console.log, err = console.error } = {}) {
  const a = parseArgs(argv);
  const out = { log, err };
  if (a.guide) {
    try {
      log(guideText());
      return 0;
    } catch (_e) {
      err(
        'The guide isn\'t here: get_setup_guide({ topic: "checks" }) has it.',
      );
      return 2;
    }
  }
  if (a.base) return runBase(a, out);
  return lib().main(a.rest, { log, err });
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main, parseArgs, baseRef };

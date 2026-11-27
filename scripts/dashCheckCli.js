#!/usr/bin/env node
/**
 * dashCheckCli.js — `dash-check`: run a repo's Dash checks by hand or in
 * CI (DASH-107, DASH-111), the way Dash runs them for a bot.
 *
 * Usage (in the repo):
 *   npx -p @trops/dash-core dash-check <name>            # run .dash/checks/<name>
 *   npx -p @trops/dash-core dash-check <name> --input f  # with a sample input
 *   npx -p @trops/dash-core dash-check <name> --base     # the base branch's copy
 *   npx -p @trops/dash-core dash-check --list            # what's there
 *   npx -p @trops/dash-core dash-check --ci [a,b]        # every check (or these)
 *   npx -p @trops/dash-core dash-check --guide           # how to write one
 *
 * A check gets the same contract as in Dash: cwd is the repo, the input as
 * JSON in $DASH_INPUT and on stdin, DASH_ITEM_*, DASH_WORKSPACE,
 * DASH_BRANCH and DASH_STEP; exit 0 passes; a last line of
 * {"reason", "details"} JSON says why.
 *
 * Exit codes: 0 passed, 1 a check failed, 2 bad arguments / no such check.
 *
 * Standalone on purpose (no Electron, nothing from dist): it runs in any
 * repo's CI with only node and git.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CHECKS_DIR = ".dash/checks";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const RUNNERS = {
  ".js": "node",
  ".cjs": "node",
  ".mjs": "node",
  ".sh": "bash",
  ".bash": "bash",
  ".py": "python3",
};
const DEFAULT_TIMEOUT_SEC = 120;
const SAMPLE = { input: { answer: "" }, item: null, workspace: null };

function parseArgs(argv) {
  const a = {
    names: [],
    input: null,
    base: false,
    list: false,
    ci: false,
    guide: false,
    help: false,
    cwd: process.cwd(),
    timeout: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--input" || v === "-i") a.input = argv[++i];
    else if (v === "--base") a.base = true;
    else if (v === "--list") a.list = true;
    else if (v === "--ci") {
      a.ci = true;
      if (argv[i + 1] && !argv[i + 1].startsWith("-"))
        a.names.push(...argv[++i].split(",").filter(Boolean));
    } else if (v === "--guide") a.guide = true;
    else if (v === "--cwd") a.cwd = path.resolve(argv[++i]);
    else if (v === "--timeout") a.timeout = Number(argv[++i]);
    else if (v === "--help" || v === "-h") a.help = true;
    else if (v.startsWith("-")) return { error: `Unknown option ${v}` };
    else a.names.push(v);
  }
  return a;
}

const git = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "buffer" });
  return r.status === 0 ? r.stdout : null;
};

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

/** The checks there: [{ name, file }] (a package folder's file is its check.json "run"). */
function listChecks(cwd, { base = false } = {}) {
  if (base) {
    const ref = baseRef(cwd);
    if (!ref)
      return {
        error: "No base branch (origin/HEAD, origin/main or origin/master)",
      };
    const out = git(["ls-tree", "--name-only", `${ref}:${CHECKS_DIR}`], cwd);
    const files = out ? out.toString().split("\n").filter(Boolean) : [];
    return {
      ref,
      checks: files.map((f) => ({ name: f.replace(/\.[^.]+$/, ""), file: f })),
    };
  }
  const dir = path.join(cwd, CHECKS_DIR);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return { checks: [] };
  }
  const checks = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || /\.(md|json|txt)$/i.test(e.name)) continue;
    if (e.isDirectory()) {
      const manifest = readManifest(path.join(dir, e.name));
      if (manifest && manifest.run)
        checks.push({
          name: e.name,
          file: path.join(e.name, manifest.run),
          manifest,
        });
      continue;
    }
    checks.push({ name: e.name.replace(/\.[^.]+$/, ""), file: e.name });
  }
  checks.sort((x, y) => x.name.localeCompare(y.name));
  return { checks };
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "check.json"), "utf8"));
  } catch (_e) {
    return null;
  }
}

function pick(checks, name) {
  return (
    checks.find((c) => path.basename(c.file) === name) ||
    checks.find((c) => c.name === name) ||
    null
  );
}

/** Run one check: { pass, reason, code, output }. */
function runOne(check, { cwd, input, base, ref, timeout }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dash-check-"));
  try {
    let file = path.join(cwd, CHECKS_DIR, check.file);
    if (base) {
      const body = git(["show", `${ref}:${CHECKS_DIR}/${check.file}`], cwd);
      if (body == null)
        return {
          pass: false,
          reason: `Can't read ${CHECKS_DIR}/${check.file} on ${ref}`,
          code: null,
          output: "",
        };
      file = path.join(tmp, path.basename(check.file));
      fs.writeFileSync(file, body, { mode: 0o755 });
    }
    const inputFile = path.join(tmp, "input.json");
    const json = JSON.stringify({
      ...input,
      ...(check.manifest ? { check: { name: check.name, inputs: {} } } : {}),
    });
    fs.writeFileSync(inputFile, json);
    const first = (() => {
      try {
        return fs.readFileSync(file, "utf8").split(/\r?\n/, 1)[0] || "";
      } catch (_e) {
        return "";
      }
    })();
    const runner = first.startsWith("#!")
      ? null
      : RUNNERS[path.extname(file).toLowerCase()] || "sh";
    if (!runner) {
      try {
        fs.chmodSync(file, 0o755);
      } catch (_e) {
        // A read-only checkout: run it through sh instead.
      }
    }
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const item = (input && input.item) || {};
    const env = {
      ...process.env,
      DASH_INPUT: inputFile,
      DASH_STEP: check.name,
      DASH_WORKSPACE: cwd,
      DASH_BRANCH:
        (input && input.workspace && input.workspace.branch) ||
        (branch ? branch.toString().trim() : ""),
      ...(item.id ? { DASH_ITEM_ID: String(item.id) } : {}),
      ...(item.title ? { DASH_ITEM_TITLE: String(item.title) } : {}),
      ...(item.url ? { DASH_ITEM_URL: String(item.url) } : {}),
      ...(item.source ? { DASH_ITEM_SOURCE: String(item.source) } : {}),
    };
    const limit =
      Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SEC;
    const r = spawnSync(runner || file, runner ? [file] : [], {
      cwd,
      env,
      input: json,
      encoding: "utf8",
      timeout: limit * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const output = `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
    if (r.error && r.error.code === "ETIMEDOUT") {
      return {
        pass: false,
        reason: `Stopped after ${limit} seconds`,
        code: null,
        output,
      };
    }
    if (r.error)
      return {
        pass: false,
        reason: `It couldn't start: ${r.error.message}`,
        code: null,
        output,
      };
    const proof = lastProof(r.stdout);
    return {
      pass: r.status === 0,
      reason:
        (proof && typeof proof.reason === "string" && proof.reason) ||
        (r.status === 0 ? `Passed (exit 0)` : `Failed (exit ${r.status})`),
      code: r.status,
      output,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function lastProof(out) {
  const lines = String(out || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
    try {
      const v = JSON.parse(lines[i]);
      if (v && typeof v === "object" && ("reason" in v || "details" in v))
        return v;
    } catch (_e) {
      // Not JSON.
    }
  }
  return null;
}

function main(argv, { log = console.log, err = console.error } = {}) {
  const a = parseArgs(argv);
  if (a.error) {
    err(a.error);
    return 2;
  }
  if (a.help || (!a.names.length && !a.list && !a.ci && !a.guide)) {
    log(
      "Usage: dash-check <name> [--input sample.json] [--base] | --list | --ci [a,b] | --guide",
    );
    return a.help ? 0 : 2;
  }
  if (a.guide) {
    const guide = path.join(
      __dirname,
      "..",
      "skills",
      "dash-check-authoring",
      "SKILL.md",
    );
    try {
      log(fs.readFileSync(guide, "utf8").replace(/^---[\s\S]*?---\n+/, ""));
      return 0;
    } catch (_e) {
      err(
        'The guide isn\'t here: get_setup_guide({ topic: "checks" }) has it.',
      );
      return 2;
    }
  }
  for (const n of a.names) {
    if (!NAME_RE.test(n) || n.includes("..")) {
      err(`"${n}" can't be a check's name`);
      return 2;
    }
  }
  const found = listChecks(a.cwd, { base: a.base });
  if (found.error) {
    err(found.error);
    return 2;
  }
  if (a.list) {
    if (!found.checks.length)
      log(`No ${CHECKS_DIR} here${found.ref ? ` on ${found.ref}` : ""}.`);
    for (const c of found.checks) log(`${c.name}\t${CHECKS_DIR}/${c.file}`);
    return 0;
  }
  let input = SAMPLE;
  if (a.input) {
    try {
      input = JSON.parse(fs.readFileSync(a.input, "utf8"));
    } catch (e) {
      err(`Can't read ${a.input}: ${e.message}`);
      return 2;
    }
  }
  const wanted = a.names.length ? a.names : found.checks.map((c) => c.name);
  if (!wanted.length) {
    log(`No ${CHECKS_DIR} here: nothing to run.`);
    return 0;
  }
  let failed = 0;
  for (const name of wanted) {
    const check = pick(found.checks, name);
    if (!check) {
      err(
        `✗ ${name}: there's no ${CHECKS_DIR}/${name}${found.ref ? ` on ${found.ref}` : ""}`,
      );
      if (!a.ci) return 2;
      failed++;
      continue;
    }
    const res = runOne(check, {
      cwd: a.cwd,
      input,
      base: a.base,
      ref: found.ref,
      timeout: a.timeout,
    });
    if (res.pass) {
      log(`✓ ${name}: ${res.reason}`);
    } else {
      failed++;
      if (res.output) log(res.output.split("\n").slice(-30).join("\n"));
      log(`✗ ${name}: ${res.reason}`);
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main, parseArgs, listChecks, runOne, lastProof };

/**
 * workspaceGuard.js — a check that works in a folder never passes when the
 * folder isn't there (DASH-165). A job's workspace can be removed after a
 * failure (a failure listener cleans up); a check run then in some other
 * folder, or in none, found "no changes" and passed: no repo, no changes.
 * Now it fails, saying the workspace is gone, and a check that reads git
 * fails when the folder isn't a git repo.
 *
 *   folderProblem(input, cwd, { git })  the reason, or null
 *
 * input.workspace.dir is the job's workspace; `cwd` is where the check
 * would run (the workspace, else the bot's first folder).
 */
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

const isDir = (dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_e) {
    return false;
  }
};

const isGitRepo = (dir) => {
  try {
    const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return String(out).trim() === "true";
  } catch (_e) {
    return false;
  }
};

/** The job's workspace folder, when the job has one. */
function workspaceDir(input) {
  const w = input && input.workspace;
  return w && typeof w.dir === "string" && w.dir.trim() ? w.dir.trim() : null;
}

/** Why the job's workspace can't be checked: it was named and is gone. */
function goneText(dir) {
  return `The job's workspace (${dir}) isn't there: it may have been removed after a failure. Nothing in it can be checked, so this check fails. Run the job again: its bots rebuild the workspace.`;
}

/**
 * @param {object} input  the check's standard input
 * @param {string|null|undefined} cwd  where it would run
 * @param {{ git?: boolean }} [opts]  git: it reads git, so the folder must
 *   be a git repo
 * @returns {string|null}
 */
function folderProblem(input, cwd, { git = false } = {}) {
  const ws = workspaceDir(input);
  if (ws && !isDir(ws)) return goneText(ws);
  const dir = ws || (typeof cwd === "string" && cwd ? cwd : null);
  if (!dir) {
    return "The job has no workspace and the bot has no folder, so there's nothing to check: this check fails.";
  }
  if (!isDir(dir)) return `${dir} isn't there, so this check fails.`;
  if (git && !isGitRepo(dir)) {
    return `${dir} isn't a git repo, so there's no work in it to check: this check fails.`;
  }
  return null;
}

module.exports = { folderProblem, workspaceDir, goneText, isGitRepo };

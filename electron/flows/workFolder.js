/**
 * workFolder.js
 *
 * Real work on your files (flows PRD, phase 5; G5). A bot can be given
 * folders (its `projects`). When a flow hands it a task, it works in its
 * own copy: a git worktree of that folder, on a branch for the goal, kept
 * in the goal's work folder — never in your checkout. A folder that isn't
 * a git repo (a notes folder) is worked in where it is.
 *
 * Deleting the goal removes its work folder; `pruneWorktrees` then tells
 * git the worktree is gone.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const git = (cwd, args, run = execFileSync) =>
  String(
    run("git", ["-C", cwd, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    }) || "",
  ).trim();

/** A branch name for a goal: dash/<goal id without its prefix>. */
function branchFor(goalId) {
  return `dash/${String(goalId || "goal")
    .replace(/^goal_/, "")
    .slice(0, 24)}`;
}

/**
 * The folder a task's run works in.
 * @param {{ folder: string, goalId: string, workRoot: string,
 *           run?: Function }} p   `run` replaces execFileSync in tests
 * @returns {{ dir: string, kind: "worktree"|"folder", branch?: string,
 *             base?: string } | { error: string }}
 */
function prepareWorkFolder({ folder, goalId, workRoot, run = execFileSync }) {
  if (!folder) return { error: "No folder is set for this bot." };
  let st;
  try {
    st = fs.statSync(folder);
  } catch (_e) {
    return { error: `The folder it works in isn't there: ${folder}` };
  }
  if (!st.isDirectory()) return { error: `That isn't a folder: ${folder}` };
  let isRepo = false;
  try {
    isRepo =
      git(folder, ["rev-parse", "--is-inside-work-tree"], run) === "true";
  } catch (_e) {
    isRepo = false;
  }
  if (!isRepo) return { dir: folder, kind: "folder" };
  const dir = path.join(workRoot, "repo");
  const branch = branchFor(goalId);
  if (fs.existsSync(path.join(dir, ".git"))) {
    return { dir, kind: "worktree", branch };
  }
  let base = "HEAD";
  try {
    base = git(folder, ["rev-parse", "--abbrev-ref", "HEAD"], run) || "HEAD";
  } catch (_e) {
    base = "HEAD";
  }
  try {
    fs.mkdirSync(workRoot, { recursive: true });
    git(folder, ["worktree", "add", "-B", branch, dir, "HEAD"], run);
  } catch (e) {
    const msg = (e && (e.stderr ? String(e.stderr) : e.message)) || String(e);
    return {
      error: `Its own copy couldn't be made: ${msg.trim().slice(0, 300)}`,
    };
  }
  return { dir, kind: "worktree", branch, base };
}

/** Tell git about worktrees whose folders are gone (after a goal is deleted). */
function pruneWorktrees(folders, run = execFileSync) {
  for (const f of [...new Set((folders || []).filter(Boolean))]) {
    try {
      git(f, ["worktree", "prune"], run);
    } catch (_e) {
      // Not a repo, or gone: nothing to prune.
    }
  }
}

module.exports = { prepareWorkFolder, pruneWorktrees, branchFor };

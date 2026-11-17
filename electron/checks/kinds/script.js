/**
 * script.js — a short function you write (or have AI write once) that gets
 * the step's input and returns { pass, reason, details } (flows PRD, phase
 * 2; frame 19). It runs sealed off (G17): its own process, with Node's
 * permission model on (no files, no processes, no workers), the network
 * taken away before it starts (sealedRunner.js), a memory limit and a time
 * limit. No AI runs when it runs.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn: nodeSpawn } = require("child_process");

const DEFAULT_TIMEOUT_SEC = 10;
const MAX_TIMEOUT_SEC = 120;
const MEMORY_MB = 64;
const MAX_SOURCE = 50 * 1024;

let runnerFile = null;

/**
 * The runner, copied out to a temp folder the child can read (a packaged
 * app keeps it inside app.asar, which the sealed child can't be allowed to
 * read as a whole).
 */
function runnerPath(tmpDir) {
  if (runnerFile && fs.existsSync(runnerFile)) return runnerFile;
  const candidates = [
    path.join(__dirname, "sealedRunner.js"),
    path.join(__dirname, "..", "checks", "sealedRunner.js"),
  ];
  const src = candidates.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch (_e) {
      return false;
    }
  });
  if (!src) throw new Error("The sealed runner is missing from this build.");
  const code = fs.readFileSync(src, "utf8");
  const hash = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex")
    .slice(0, 12);
  const dir = path.join(tmpDir || os.tmpdir(), `dash-sealed-${hash}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "runner.js");
  if (!fs.existsSync(file)) fs.writeFileSync(file, code);
  // The real path: the permission model checks it, not a symlinked one
  // (macOS's temp folder is under /var → /private/var).
  runnerFile = fs.realpathSync(file);
  return runnerFile;
}

/** How to start a plain Node process: Electron as Node, or this Node. */
function nodeCommand() {
  if (process.versions.electron) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command: process.execPath, env: {} };
}

/**
 * Node's permission model flag: `--permission` from Node 22.13 (what
 * Electron ships), `--experimental-permission` before that (Node 20). The
 * child is the same Node as this process, so its version decides.
 */
function permissionFlag(version = process.versions.node) {
  const [major, minor] = String(version).split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13)
    ? "--permission"
    : "--experimental-permission";
}

function timeoutOf(check) {
  const n = Math.floor(Number(check && check.timeoutSec));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TIMEOUT_SEC;
  return Math.min(n, MAX_TIMEOUT_SEC);
}

/**
 * Run a script check.
 * @param {{ script: string, timeoutSec?: number }} check
 * @param {object} input  the standard input
 * @param {{ spawn?: Function, tmpDir?: string, source?: string }} opts
 *   `source` replaces check.script (a script kept in the flow's folder)
 */
function runScript(check, input, opts = {}) {
  const source = String(
    opts.source != null ? opts.source : (check && check.script) || "",
  );
  if (!source.trim()) {
    return Promise.resolve({ pass: false, reason: "No script is written yet" });
  }
  if (source.length > MAX_SOURCE) {
    return Promise.resolve({
      pass: false,
      reason: "The script is too long (50 KB at most)",
    });
  }
  let file;
  try {
    file = runnerPath(opts.tmpDir);
  } catch (e) {
    return Promise.resolve({
      pass: false,
      reason: (e && e.message) || String(e),
    });
  }
  const spawn = opts.spawn || nodeSpawn;
  const node = nodeCommand();
  const limit = timeoutOf(check);
  const args = [
    permissionFlag(),
    `--allow-fs-read=${file}`,
    `--max-old-space-size=${MEMORY_MB}`,
    "--disallow-code-generation-from-strings",
    file,
  ];
  // Only what Node needs to start: none of the app's keys or tokens.
  const env = {
    ...node.env,
    PATH: process.env.PATH || "",
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
  };
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    let timedOut = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res);
    };
    let child;
    try {
      child = spawn(node.command, args, {
        cwd: path.dirname(file),
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      finish({
        pass: false,
        reason: `It couldn't start: ${(e && e.message) || e}`,
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch (_e) {
        // Already gone.
      }
    }, limit * 1000);
    child.stdout.on("data", (d) => {
      if (out.length < 256 * 1024) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < 16 * 1024) err += d.toString();
    });
    child.on("error", (e) =>
      finish({
        pass: false,
        reason: `It couldn't start: ${(e && e.message) || e}`,
      }),
    );
    child.on("close", () => {
      if (timedOut) {
        finish({ pass: false, reason: `Stopped after ${limit} seconds` });
        return;
      }
      const line = out
        .split(/\r?\n/)
        .reverse()
        .find((l) => l.startsWith("DASH_RESULT "));
      if (!line) {
        finish({
          pass: false,
          reason: /heap out of memory|Allocation failed/i.test(err)
            ? `Stopped: it used more than ${MEMORY_MB} MB`
            : "The script stopped without an answer",
          ...(err ? { output: err.slice(-2000) } : {}),
        });
        return;
      }
      try {
        finish(JSON.parse(line.slice("DASH_RESULT ".length)));
      } catch (_e) {
        finish({ pass: false, reason: "The script's answer couldn't be read" });
      }
    });
    try {
      child.stdin.on("error", () => {});
      child.stdin.end(
        JSON.stringify({ source, input: input == null ? {} : input }),
      );
    } catch (_e) {
      // Reported by close.
    }
  });
}

module.exports = {
  runScript,
  runnerPath,
  permissionFlag,
  DEFAULT_TIMEOUT_SEC,
  MEMORY_MB,
};

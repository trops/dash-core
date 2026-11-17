/**
 * command.js — a check that runs a command you already have (flows PRD,
 * phase 2; frame 18). The step's input goes to it as JSON on standard input
 * and in the file named by $DASH_INPUT. It passes when the command finishes
 * without an error (exit code 0), or when its output contains or matches
 * what was set. Anything it prints as {"reason", "details"} on its last
 * line becomes the proof; its output is kept either way.
 *
 * Commands that are always blocked (commandRules.js) never run. A time
 * limit stops one that hangs.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn: nodeSpawn } = require("child_process");
const { blockedBy } = require("../commandRules");

const DEFAULT_TIMEOUT_SEC = 120;
const MAX_TIMEOUT_SEC = 30 * 60;
const MAX_OUTPUT = 64 * 1024;

function timeoutOf(check) {
  const n = Math.floor(Number(check && check.timeoutSec));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TIMEOUT_SEC;
  return Math.min(n, MAX_TIMEOUT_SEC);
}

/** Its last line, when that's {"reason", "details"} JSON. */
function proofLine(out) {
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

function passes(check, code, out) {
  const when = (check && check.passWhen) || { type: "exit0" };
  if (when.type === "contains") {
    return code === 0 && String(out).includes(String(when.text || ""));
  }
  if (when.type === "matches") {
    try {
      return new RegExp(String(when.pattern || ""), "m").test(String(out));
    } catch (_e) {
      return false;
    }
  }
  return code === 0;
}

const tail = (s, n = 4000) => {
  const t = String(s || "");
  return t.length > n ? `…${t.slice(-n)}` : t;
};

/**
 * Run a command check.
 * @param {{ command: string, timeoutSec?: number, passWhen?: object }} check
 * @param {object} input  the standard input (stepInput.js)
 * @param {{ cwd: string, env?: object, spawn?: Function, tmpDir?: string }} opts
 * @returns {Promise<{ pass, reason, details, output, exitCode }>}
 */
function runCommand(check, input, opts = {}) {
  const command = String((check && check.command) || "").trim();
  if (!command) {
    return Promise.resolve({ pass: false, reason: "No command is set" });
  }
  const blocked = blockedBy(command);
  if (blocked) {
    return Promise.resolve({
      pass: false,
      reason: `Not run: ${blocked.label} is always blocked`,
    });
  }
  const cwd = opts.cwd;
  if (!cwd || !fs.existsSync(cwd)) {
    return Promise.resolve({
      pass: false,
      reason: "The folder it runs in isn't there",
    });
  }
  const spawn = opts.spawn || nodeSpawn;
  const json = JSON.stringify(input == null ? {} : input);
  const dir = fs.mkdtempSync(
    path.join(opts.tmpDir || os.tmpdir(), "dash-check-"),
  );
  const inputFile = path.join(dir, "input.json");
  fs.writeFileSync(inputFile, json);
  const limit = timeoutOf(check);
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    let timedOut = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_e) {
        // A temp folder left behind is harmless.
      }
      resolve(res);
    };
    let child;
    try {
      child = spawn(command, {
        cwd,
        shell: true,
        env: { ...process.env, ...(opts.env || {}), DASH_INPUT: inputFile },
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
      if (out.length < MAX_OUTPUT) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < MAX_OUTPUT) err += d.toString();
    });
    child.on("error", (e) =>
      finish({
        pass: false,
        reason: `It couldn't start: ${(e && e.message) || e}`,
      }),
    );
    child.on("close", (code) => {
      if (timedOut) {
        finish({
          pass: false,
          reason: `Stopped after ${limit} seconds`,
          output: tail(out + err),
          exitCode: null,
        });
        return;
      }
      const proof = proofLine(out);
      const ok = passes(check, code, out);
      finish({
        pass: ok,
        reason:
          (proof && typeof proof.reason === "string" && proof.reason) ||
          (ok ? `Passed (exit ${code})` : `Failed (exit ${code})`),
        details: proof && proof.details !== undefined ? proof.details : null,
        output: tail(out + (err ? `\n${err}` : "")),
        exitCode: code,
      });
    });
    try {
      child.stdin.on("error", () => {});
      child.stdin.end(json);
    } catch (_e) {
      // A command that doesn't read its input.
    }
  });
}

module.exports = { runCommand, proofLine, DEFAULT_TIMEOUT_SEC };

/**
 * cliController.js
 *
 * Manages Claude Code CLI (`claude -p`) as an alternative LLM backend.
 * Spawns the CLI subprocess, parses stream-json NDJSON output, and emits
 * the same LLM_STREAM_* events as the Anthropic SDK path.
 *
 * Users with a Claude Pro/Max subscription and Claude Code installed
 * can use the Chat widget without a separate API key.
 */
const { spawn, execSync } = require("child_process");
const {
  LLM_STREAM_DELTA,
  LLM_STREAM_TOOL_CALL,
  LLM_STREAM_TOOL_RESULT,
  LLM_STREAM_COMPLETE,
  LLM_STREAM_ERROR,
} = require("../events/llmEvents");

const IS_WINDOWS = process.platform === "win32";

/**
 * Cached shell PATH result (resolved once, reused for all spawns).
 * Same pattern as mcpController.js.
 */
let _shellPath = null;

function getShellPath() {
  if (_shellPath !== null) return _shellPath;

  // Windows: no POSIX login-shell trick — just use the inherited PATH,
  // which is typically correct for GUI-launched Electron apps.
  if (IS_WINDOWS) {
    _shellPath = process.env.PATH || "";
    return _shellPath;
  }

  try {
    const shell = process.env.SHELL || "/bin/bash";
    _shellPath = execSync(`${shell} -ilc 'echo -n "$PATH"'`, {
      encoding: "utf8",
      timeout: 5000,
    });
  } catch {
    _shellPath = process.env.PATH || "";
  }

  return _shellPath;
}

/**
 * Cached CLI binary path (resolved once via `which` / `where`).
 */
let _cliBinaryPath = undefined; // undefined = not yet checked

function resolveCliBinary() {
  if (_cliBinaryPath !== undefined) return _cliBinaryPath;

  try {
    const fullPath = getShellPath();
    // `where` on Windows, `which` everywhere else. `where` may list
    // multiple matches on separate lines (e.g. claude.cmd + claude.ps1)
    // — take the first hit.
    const lookup = IS_WINDOWS ? "where claude" : "which claude";
    const result = execSync(lookup, {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, PATH: fullPath },
    });
    _cliBinaryPath = IS_WINDOWS
      ? result
          .split(/\r?\n/)
          .find((l) => l.trim())
          ?.trim() || null
      : result.trim();
  } catch {
    _cliBinaryPath = null;
  }

  return _cliBinaryPath;
}

/**
 * Active CLI processes for abort support.
 * Map<requestId, ChildProcess>
 */
const activeProcesses = new Map();

/**
 * Kill a child process and its descendants. On Windows, spawning with
 * shell:true (needed for .cmd targets) means child.kill() only
 * terminates the cmd.exe — the real CLI keeps running. Use taskkill
 * with /T (tree) /F (force) to clean up.
 */
function killChildTree(child) {
  if (!child || child.killed || typeof child.pid !== "number") return;
  if (IS_WINDOWS) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, {
        stdio: "ignore",
        timeout: 5000,
      });
    } catch {
      // Fall back to plain kill — best-effort
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  } else {
    child.kill("SIGTERM");
  }
}

/**
 * Session IDs for conversation continuity.
 * Map<widgetUuid, sessionId>
 */
const sessions = new Map();

/**
 * Send events safely to a window.
 */
function safeSend(win, channel, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

const cliController = {
  /**
   * isAvailable
   * Check if the Claude Code CLI is installed and accessible.
   *
   * @returns {{ available: boolean, path?: string }}
   */
  isAvailable: () => {
    const binaryPath = resolveCliBinary();
    if (binaryPath) {
      return { available: true, path: binaryPath };
    }
    return { available: false };
  },

  /**
   * sendMessage
   * Stream a response from the Claude Code CLI with NDJSON parsing.
   *
   * @param {BrowserWindow} win - the window to send stream events to
   * @param {string} requestId - unique ID for this request
   * @param {object} params - { model, messages, systemPrompt, maxToolRounds, widgetUuid }
   */
  sendMessage: async (win, requestId, params) => {
    const { model, messages, systemPrompt, widgetUuid, cwd } = params;

    const binaryPath = resolveCliBinary();
    if (!binaryPath) {
      safeSend(win, LLM_STREAM_ERROR, {
        requestId,
        error:
          "Claude Code CLI not found. Install from https://claude.ai/download",
        code: "CLI_NOT_FOUND",
      });
      return;
    }

    // Build CLI args.
    //
    // --disable-slash-commands: prevent Claude from auto-triggering project
    // skills by description match. When running in a project with a
    // `.claude/skills/<name>/SKILL.md`, Claude would otherwise internalize
    // that skill's content even when the host app's system prompt says not
    // to — causing long reasoning loops or silent hangs. We pass only the
    // caller's `systemPrompt` as context.
    //
    // --permission-mode bypassPermissions: in an embedded in-app assistant,
    // the user has already opted into the configured MCP servers (they
    // ran `claude mcp add` themselves). Prompting for tool-use approval
    // on every call produces "I need permission to..." replies instead of
    // actual actions. Bypassing matches the user's intent — if they
    // didn't want the assistant to use a tool, they wouldn't have
    // configured it.
    //
    // (We intentionally avoid `--bare` — it also disables keychain reads,
    // which breaks OAuth login for users authenticated via `claude login`.)
    const args = [
      "-p",
      "--disable-slash-commands",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    if (model) {
      args.push("--model", model);
    }

    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }

    // Resume existing session for conversation continuity
    const sessionId = widgetUuid ? sessions.get(widgetUuid) : null;
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    // Extract the user message (last user message in the array)
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const userText =
      typeof lastUserMsg?.content === "string"
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg?.content)
          ? lastUserMsg.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("\n")
          : "";

    if (!userText) {
      safeSend(win, LLM_STREAM_ERROR, {
        requestId,
        error: "No user message to send.",
        code: "CLI_ERROR",
      });
      return;
    }

    try {
      const fullPath = getShellPath();
      const spawnOpts = {
        env: { ...process.env, PATH: fullPath },
        stdio: ["pipe", "pipe", "pipe"],
        // On Windows, the Claude CLI is typically installed as claude.cmd
        // (a batch wrapper). Node's child_process.spawn can't launch .cmd
        // files directly without a shell — ENOENT otherwise.
        shell: IS_WINDOWS,
      };
      if (cwd) {
        const fs = require("fs");
        if (!fs.existsSync(cwd)) {
          fs.mkdirSync(cwd, { recursive: true });
        }
        spawnOpts.cwd = cwd;
      }
      const child = spawn(binaryPath, args, spawnOpts);

      activeProcesses.set(requestId, child);

      // Pipe user message via stdin (not visible in ps)
      child.stdin.write(userText);
      child.stdin.end();

      let stdoutBuffer = "";
      let stderrBuffer = "";
      let capturedSessionId = null;
      let retried = false;

      // Track active tool calls for mapping results
      const activeToolCalls = new Map();

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();

        // Process complete lines
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            console.warn("[cliController] Skipping invalid JSON line:", line);
            continue;
          }

          // Capture session ID from any message that has it
          if (parsed.session_id && widgetUuid) {
            capturedSessionId = parsed.session_id;
            sessions.set(widgetUuid, capturedSessionId);
          }

          // Map CLI stream-json events to IPC events
          if (parsed.type === "content_block_delta") {
            if (parsed.delta?.type === "text_delta" && parsed.delta.text) {
              safeSend(win, LLM_STREAM_DELTA, {
                requestId,
                text: parsed.delta.text,
              });
            } else if (parsed.delta?.type === "input_json_delta") {
              // Update tool input incrementally
              const tc = activeToolCalls.get(parsed.index);
              if (tc) {
                tc.partialInput =
                  (tc.partialInput || "") + (parsed.delta.partial_json || "");
              }
            }
          } else if (parsed.type === "content_block_start") {
            if (parsed.content_block?.type === "tool_use") {
              const toolBlock = parsed.content_block;
              activeToolCalls.set(parsed.index, {
                toolUseId: toolBlock.id,
                toolName: toolBlock.name,
                partialInput: "",
              });
              safeSend(win, LLM_STREAM_TOOL_CALL, {
                requestId,
                toolUseId: toolBlock.id,
                toolName: toolBlock.name,
                serverName: "Claude Code",
                input: toolBlock.input || {},
              });
            }
          } else if (parsed.type === "content_block_stop") {
            // Tool call completed — try to parse the accumulated input
            const tc = activeToolCalls.get(parsed.index);
            if (tc && tc.partialInput) {
              try {
                tc.finalInput = JSON.parse(tc.partialInput);
              } catch {
                tc.finalInput = tc.partialInput;
              }
            }
          } else if (parsed.type === "message_stop") {
            // Individual message completed (may be followed by more in tool-use loops)
          } else if (parsed.type === "result") {
            // Final result — conversation complete
            const content = [];
            if (parsed.result) {
              content.push({ type: "text", text: parsed.result });
            }

            safeSend(win, LLM_STREAM_COMPLETE, {
              requestId,
              content,
              stopReason: parsed.stop_reason || "end_turn",
              usage: parsed.usage || {},
            });
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString();
      });

      child.on("error", (err) => {
        activeProcesses.delete(requestId);
        safeSend(win, LLM_STREAM_ERROR, {
          requestId,
          error: `Failed to start Claude CLI: ${err.message}`,
          code: "CLI_SPAWN_ERROR",
        });
      });

      child.on("close", (code) => {
        activeProcesses.delete(requestId);

        // Process any remaining buffer
        if (stdoutBuffer.trim()) {
          try {
            const parsed = JSON.parse(stdoutBuffer);
            if (parsed.session_id && widgetUuid) {
              sessions.set(widgetUuid, parsed.session_id);
            }
            if (parsed.type === "result") {
              const content = [];
              if (parsed.result) {
                content.push({ type: "text", text: parsed.result });
              }
              safeSend(win, LLM_STREAM_COMPLETE, {
                requestId,
                content,
                stopReason: parsed.stop_reason || "end_turn",
                usage: parsed.usage || {},
              });
              return;
            }
          } catch {
            // ignore
          }
        }

        if (code !== 0 && code !== null) {
          // Check if resume failed and retry without it
          if (sessionId && !retried && stderrBuffer.includes("session")) {
            retried = true;
            if (widgetUuid) sessions.delete(widgetUuid);
            // Retry without --resume
            cliController.sendMessage(win, requestId, {
              ...params,
              _retryWithoutResume: true,
            });
            return;
          }

          // Check for auth errors
          if (
            stderrBuffer.includes("auth") ||
            stderrBuffer.includes("login") ||
            stderrBuffer.includes("not authenticated")
          ) {
            safeSend(win, LLM_STREAM_ERROR, {
              requestId,
              error:
                "Claude Code CLI is not authenticated. Run `claude auth login` in your terminal.",
              code: "CLI_AUTH_ERROR",
            });
            return;
          }

          safeSend(win, LLM_STREAM_ERROR, {
            requestId,
            error: `Claude CLI exited with code ${code}${stderrBuffer ? ": " + stderrBuffer.slice(0, 500) : ""}`,
            code: "CLI_ERROR",
          });
        }
      });
    } catch (err) {
      activeProcesses.delete(requestId);
      safeSend(win, LLM_STREAM_ERROR, {
        requestId,
        error: `Failed to start Claude CLI: ${err.message}`,
        code: "CLI_SPAWN_ERROR",
      });
    }
  },

  /**
   * abortRequest
   * Kill an in-flight CLI process.
   *
   * @param {string} requestId - the request to cancel
   * @returns {{ success: boolean }}
   */
  abortRequest: (requestId) => {
    const child = activeProcesses.get(requestId);
    if (child) {
      killChildTree(child);
      activeProcesses.delete(requestId);
      return { success: true };
    }
    return { success: false, message: "Request not found" };
  },

  /**
   * clearSession
   * Remove the stored session ID for a widget (called on "New Chat").
   *
   * @param {string} widgetUuid - the widget whose session to clear
   * @returns {{ success: boolean }}
   */
  clearSession: (widgetUuid) => {
    if (widgetUuid && sessions.has(widgetUuid)) {
      sessions.delete(widgetUuid);
      return { success: true };
    }
    return { success: false };
  },

  /**
   * getSessionStatus
   * Check if a CLI session exists and whether a process is active for a widget.
   *
   * @param {string} widgetUuid - the widget to check
   * @returns {{ hasSession: boolean, sessionId?: string, isProcessActive: boolean }}
   */
  getSessionStatus: (widgetUuid) => {
    const sessionId = widgetUuid ? sessions.get(widgetUuid) : null;
    // Check if any active process belongs to this widget
    let isProcessActive = false;
    for (const [, child] of activeProcesses) {
      if (!child.killed) {
        isProcessActive = true;
        break;
      }
    }
    return {
      hasSession: !!sessionId,
      sessionId: sessionId || undefined,
      isProcessActive,
    };
  },

  /**
   * endSession
   * Kill any active CLI process AND clear the session for a widget.
   *
   * @param {string} widgetUuid - the widget whose session to end
   * @returns {{ success: boolean }}
   */
  endSession: (widgetUuid) => {
    // Kill any active processes for this widget
    for (const [reqId, child] of activeProcesses) {
      if (reqId.startsWith(widgetUuid)) {
        killChildTree(child);
        activeProcesses.delete(reqId);
      }
    }
    // Clear the session
    if (widgetUuid && sessions.has(widgetUuid)) {
      sessions.delete(widgetUuid);
    }
    return { success: true };
  },
};

module.exports = cliController;

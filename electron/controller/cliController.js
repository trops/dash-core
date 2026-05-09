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
 * Quote a string for cmd.exe when `shell: true` is in effect. With
 * shell:true on Windows, Node joins command+args into one string and
 * hands it to `cmd.exe /d /s /c`, which tokenizes on whitespace. A
 * path like `C:\Users\First Name\AppData\...\claude.cmd` would parse
 * as two tokens (`C:\Users\First` + junk) without quoting. No-op when
 * the string has no whitespace or quote character.
 */
function windowsQuote(s) {
  const str = String(s);
  if (!/[\s"]/.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

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

/**
 * Resolve the working directory the spawned CLI should run in.
 *
 * Pure / no I/O — extracted so it can be unit-tested. The actual
 * mkdir + spawnOpts.cwd assignment happens at the spawn site.
 *
 * Why this exists: when the widget-builder modal launches the CLI in
 * lockdown mode, the spawned process inherits the parent (Electron)
 * process cwd. In a dev build that's the dash-electron project root,
 * which contains a CLAUDE.md describing the 4-phase development
 * workflow. The CLI auto-loads that file and the AI announces "Let me
 * scan the existing project to understand what's already here." —
 * exactly what the lockdown was meant to prevent.
 *
 * Resolution order:
 *   1. Caller passed an explicit cwd → use that (caller wins).
 *   2. disableTools: true and no cwd → scratch dir under os.tmpdir().
 *   3. Otherwise → null (caller doesn't set spawnOpts.cwd; the child
 *      inherits the parent's cwd, preserving AssistantPanel behavior
 *      where project context may be wanted).
 *
 * @param {object}  opts
 * @param {string=} opts.cwd
 * @param {boolean=} opts.disableTools
 * @returns {string|null}
 */
function resolveLockdownCwd({ cwd, disableTools = false } = {}) {
  if (cwd) return cwd;
  if (disableTools) {
    const os = require("os");
    const path = require("path");
    return path.join(os.tmpdir(), "dash-widget-builder-cli");
  }
  return null;
}

/**
 * Resolve the plugin directory the spawned CLI should look in.
 *
 * Same shape as resolveLockdownCwd. When in lockdown, point Claude
 * Code at an empty scratch directory so plugin auto-discovery finds
 * nothing — sealing the gap left by `--bare` (which strips CLAUDE.md
 * and auto-memory but NOT user plugins under ~/.claude/plugins/).
 * The Skill tool gets loaded from those plugins, which is how it
 * survived the slice 17f flag set.
 *
 * Sibling of the scratch cwd dir — DIFFERENT name so plugin discovery
 * doesn't pick up the cwd itself.
 *
 * @param {object}  opts
 * @param {string=} opts.pluginDir
 * @param {boolean=} opts.disableTools
 * @returns {string|null}
 */
function resolveLockdownPluginDir({ pluginDir, disableTools = false } = {}) {
  if (pluginDir) return pluginDir;
  if (disableTools) {
    const os = require("os");
    const path = require("path");
    return path.join(os.tmpdir(), "dash-widget-builder-cli-plugins");
  }
  return null;
}

/**
 * Canonical denylist for the lockdown — every built-in tool name we
 * know about, comma-separated (no whitespace) so the single arg is
 * Windows-shell-safe. Adding a new built-in upstream means appending
 * its name here; the flag is belt-and-suspenders alongside `--tools ""`,
 * but it's the only layer that actually keeps the Skill tool from
 * being callable when a user has plugins installed in
 * ~/.claude/plugins/.
 */
const LOCKDOWN_DISALLOWED_TOOLS = [
  "Skill",
  "Bash",
  "BashOutput",
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "NotebookRead",
  "NotebookEdit",
  "Task",
  "TodoWrite",
  "KillBash",
  "SlashCommand",
].join(",");

/**
 * Build the argv array for spawning the Claude Code CLI.
 *
 * Pure / no I/O — extracted as a top-level helper so it can be unit-
 * tested without spawning a child process.
 *
 * Defaults preserve AssistantPanel behavior: system prompt is APPENDED
 * to Claude Code's default (so the AI still sees its tool / MCP /
 * skill preamble) and built-in tools stay available. The widget
 * builder modal opts into a stricter mode by passing both
 * `replaceSystemPrompt: true` (replace the default rather than append
 * — strips the tool / skill preamble) and `disableTools: true` (deny
 * all built-in tools so the AI cannot invoke Skill / Bash / Read /
 * Glob / etc.).
 *
 * @param {object}  opts
 * @param {string=} opts.model
 * @param {string=} opts.systemPrompt
 * @param {string=} opts.sessionId
 * @param {boolean=} opts.replaceSystemPrompt
 * @param {boolean=} opts.disableTools
 * @returns {string[]}
 */
function buildClaudeCliArgs({
  model,
  systemPrompt,
  sessionId,
  replaceSystemPrompt = false,
  disableTools = false,
} = {}) {
  const args = [
    "-p",
    "--disable-slash-commands",
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  if (disableTools) {
    // Empty-string value documented in `claude --help` as "disable
    // all tools". Catches Skill / Bash / Read / Glob / Grep / Edit /
    // Write — every built-in tool the AI might otherwise invoke from
    // inside the modal where only text + code-block output is wanted.
    args.push("--tools", "");

    // `--tools ""` alone leaks ambient context: in 2.1.138 we saw the
    // AI mention `mcp__dash__*` tool names by name, and the Skill
    // tool kept firing despite the empty allowlist. The leak comes
    // from outside cwd — global ~/.claude/CLAUDE.md, project memory
    // under ~/.claude/projects/<key>/memory/, and user-installed
    // skills. `--bare` is documented as "skip hooks, LSP, plugin
    // sync, attribution, auto-memory, background prefetches, keychain
    // reads, and CLAUDE.md auto-discovery." Combined with
    // `--strict-mcp-config` (which suppresses every MCP server we
    // don't explicitly pass via --mcp-config), the spawned CLI gets
    // exactly our --system-prompt and nothing else.
    args.push("--bare");
    args.push("--strict-mcp-config");

    // `--bare` strips CLAUDE.md and auto-memory but NOT user plugins
    // (under ~/.claude/plugins/). The Skill TOOL gets loaded from
    // those plugins, which is why it kept firing despite slices 17e
    // and 17f. Two layers seal it:
    //   1. --disallowed-tools denies every known built-in by name
    //      (comma-separated, no whitespace, Windows-shell-safe).
    //   2. --plugin-dir points at an empty scratch dir under
    //      os.tmpdir() so plugin auto-discovery finds nothing.
    args.push("--disallowed-tools", LOCKDOWN_DISALLOWED_TOOLS);
    args.push("--plugin-dir", resolveLockdownPluginDir({ disableTools: true }));
  }

  if (model) {
    args.push("--model", model);
  }

  if (systemPrompt) {
    // --system-prompt REPLACES the default Claude Code preamble (the
    // one that introduces tools and auto-loads project skills by
    // description match). --append-system-prompt KEEPS the default
    // and adds ours below — fine for the assistant panel where MCP
    // tools are wanted, wrong for the widget builder modal where
    // any tool advertisement undermines the no-tools rule.
    args.push(
      replaceSystemPrompt ? "--system-prompt" : "--append-system-prompt",
      systemPrompt,
    );
  }

  if (sessionId) {
    args.push("--resume", sessionId);
  }

  return args;
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
    const {
      model,
      messages,
      systemPrompt,
      widgetUuid,
      cwd,
      replaceSystemPrompt = false,
      disableTools = false,
    } = params;

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

    // Build CLI args via the pure helper (see top of file). Defaults
    // preserve the AssistantPanel behavior (append-system-prompt,
    // tools available, MCP wired). The widget builder modal opts
    // into `replaceSystemPrompt + disableTools` to lock the AI to
    // text + code-block output with no tool invocations.
    //
    // The model + systemPrompt + sessionId pieces are added inside
    // buildClaudeCliArgs; below we only add args that depend on
    // runtime state (MCP config file paths) the helper can't know.
    const sessionIdForResume = widgetUuid ? sessions.get(widgetUuid) : null;
    const args = buildClaudeCliArgs({
      model,
      systemPrompt,
      sessionId: sessionIdForResume,
      replaceSystemPrompt,
      disableTools,
    });

    // Auto-wire the hosted Dash MCP server so the assistant can use Dash
    // tools (apply_theme, create_dashboard, add_widget, etc.) without
    // the user running `claude mcp add dash ...` themselves. We write
    // the JSON to a short-lived temp file and pass its path via
    // --mcp-config; merges with any user-configured MCPs so their
    // other tools (github, slack, etc.) remain available.
    //
    // We use a file, not inline JSON, because the inline form is
    // fragile on Windows: shell:true hands the arg to cmd.exe which
    // tokenizes on embedded whitespace inside the JSON (notably in
    // "Authorization: Bearer <UUID>" and the URL). Even with proper
    // windowsQuote escaping, cmd.exe's `""` handling inside /d /s /c
    // drops tokens — the user sees "MCP config file not found" with
    // fragments of the JSON prepended to cwd. Writing the JSON to a
    // file avoids every layer of that problem.
    //
    // Prereqs: the Dash MCP server is running and has issued a bearer
    // token. If either is missing (server disabled, first launch before
    // auto-start completes), we silently skip — the assistant still
    // works for non-Dash queries, and the setup banner remains visible
    // as a manual fallback.
    let mcpConfigFilePath = null;
    // Skip MCP wiring entirely when the caller has asked for a
    // tool-free invocation. There's no point loading remote tools
    // the AI cannot call, and avoiding the temp-file write keeps
    // the lockdown mode side-effect-free.
    try {
      const mcpDashServerController = require("./mcpDashServerController");
      const status = disableTools
        ? null
        : mcpDashServerController.getStatus?.(win);
      if (status?.running) {
        const token = mcpDashServerController.getOrCreateToken?.(win);
        if (token) {
          const port = status.port || 3141;
          const mcpConfig = JSON.stringify({
            mcpServers: {
              dash: {
                type: "stdio",
                command: "npx",
                args: [
                  "mcp-remote",
                  `https://127.0.0.1:${port}/mcp`,
                  "--header",
                  `Authorization: Bearer ${token}`,
                ],
                env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
              },
            },
          });
          const os = require("os");
          const path = require("path");
          const fs = require("fs");
          // Unique per-request filename so concurrent assistant calls
          // don't race on the same file. The token is sensitive, so
          // mode 0600 — owner read/write only.
          mcpConfigFilePath = path.join(
            os.tmpdir(),
            `dash-mcp-config-${requestId}.json`,
          );
          fs.writeFileSync(mcpConfigFilePath, mcpConfig, { mode: 0o600 });
          args.push("--mcp-config", mcpConfigFilePath);
        }
      }
    } catch (err) {
      // Non-fatal: log and continue without Dash MCP.
      console.warn(
        "[cliController] Failed to inject Dash MCP config:",
        err?.message,
      );
    }

    // Best-effort cleanup of the temp MCP config file. Called from
    // both child exit handlers and the outer catch. Safe to call
    // multiple times — becomes a no-op after the first unlink.
    const cleanupMcpConfigFile = () => {
      if (!mcpConfigFilePath) return;
      try {
        require("fs").unlinkSync(mcpConfigFilePath);
      } catch {
        // File may already be gone; ignore.
      }
      mcpConfigFilePath = null;
    };

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
      const resolvedCwd = resolveLockdownCwd({ cwd, disableTools });
      if (resolvedCwd) {
        const fs = require("fs");
        if (!fs.existsSync(resolvedCwd)) {
          fs.mkdirSync(resolvedCwd, { recursive: true });
        }
        spawnOpts.cwd = resolvedCwd;
      }
      // The --plugin-dir argv we built above points at a scratch
      // directory; create it on first run so the CLI doesn't error
      // out trying to read a missing path.
      if (disableTools) {
        const fs = require("fs");
        const lockdownPluginDir = resolveLockdownPluginDir({
          disableTools: true,
        });
        if (lockdownPluginDir && !fs.existsSync(lockdownPluginDir)) {
          fs.mkdirSync(lockdownPluginDir, { recursive: true });
        }
      }
      const spawnCmd = IS_WINDOWS ? windowsQuote(binaryPath) : binaryPath;
      const spawnArgs = IS_WINDOWS ? args.map(windowsQuote) : args;
      const child = spawn(spawnCmd, spawnArgs, spawnOpts);

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

          // Claude Code's stream-json emits complete-message envelopes
          // ({"type": "assistant", "message": {content: [...]}}) rather
          // than the granular content_block_start/delta/stop events used
          // by the raw Anthropic streaming API. We handle both shapes —
          // the complete-message path is the one that actually fires in
          // CLI mode today (the content_block_* branches remain in case a
          // future CLI version or --include-partial-messages flag brings
          // back the granular form).
          if (parsed.type === "assistant" && parsed.message?.content) {
            for (const block of parsed.message.content) {
              if (block?.type === "text" && block.text) {
                // Emit as a single delta so the renderer sees the text.
                // (Granular deltas aren't produced in this mode.)
                safeSend(win, LLM_STREAM_DELTA, {
                  requestId,
                  text: block.text,
                });
              } else if (block?.type === "tool_use" && block.id && block.name) {
                safeSend(win, LLM_STREAM_TOOL_CALL, {
                  requestId,
                  toolUseId: block.id,
                  toolName: block.name,
                  serverName: "Claude Code",
                  input: block.input || {},
                });
              }
            }
            continue;
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
                // Seed with any input already present on the start event.
                seedInput: toolBlock.input || {},
                partialInput: "",
              });
              // Emission deferred to content_block_stop so the renderer
              // receives the fully-parsed input (the Anthropic streaming
              // format delivers input as incremental JSON deltas).
            }
          } else if (parsed.type === "content_block_stop") {
            // Tool call completed — parse accumulated input and emit the
            // single LLM_STREAM_TOOL_CALL for this tool with the real input.
            const tc = activeToolCalls.get(parsed.index);
            if (tc) {
              if (tc.partialInput) {
                try {
                  tc.finalInput = JSON.parse(tc.partialInput);
                } catch {
                  tc.finalInput = tc.partialInput;
                }
              }
              const resolvedInput =
                tc.finalInput !== undefined
                  ? tc.finalInput
                  : tc.seedInput || {};
              if (tc.toolUseId && tc.toolName) {
                safeSend(win, LLM_STREAM_TOOL_CALL, {
                  requestId,
                  toolUseId: tc.toolUseId,
                  toolName: tc.toolName,
                  serverName: "Claude Code",
                  input: resolvedInput,
                });
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
        cleanupMcpConfigFile();
        activeProcesses.delete(requestId);
        safeSend(win, LLM_STREAM_ERROR, {
          requestId,
          error: `Failed to start Claude CLI: ${err.message}`,
          code: "CLI_SPAWN_ERROR",
        });
      });

      child.on("close", (code) => {
        cleanupMcpConfigFile();
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
          if (
            sessionIdForResume &&
            !retried &&
            stderrBuffer.includes("session")
          ) {
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
      cleanupMcpConfigFile();
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
module.exports.buildClaudeCliArgs = buildClaudeCliArgs;
module.exports.resolveLockdownCwd = resolveLockdownCwd;
module.exports.resolveLockdownPluginDir = resolveLockdownPluginDir;
module.exports.LOCKDOWN_DISALLOWED_TOOLS = LOCKDOWN_DISALLOWED_TOOLS;

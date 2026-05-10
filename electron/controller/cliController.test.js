/**
 * Pins the CLI args produced by cliController for the
 * Claude Code child process.
 *
 * Why this exists: the in-app widget builder modal needs the AI to
 * produce text + code blocks ONLY — no Skill / Bash / Read / Glob
 * tool calls. The previous wiring sent `--append-system-prompt` so
 * Claude Code's default system prompt (which advertises the available
 * tools and auto-loads project skills by description match) stayed
 * active and overrode our explicit "no tools" rule.
 *
 * The fix: per-call lockdown flags. When `replaceSystemPrompt: true`,
 * use `--system-prompt` (replaces the default rather than appending
 * to it) so the AI doesn't see Claude Code's tool / skill preamble.
 * When `disableTools: true`, append `--tools ""` so no built-in tools
 * are available at all.
 *
 * Defaults preserve the AssistantPanel behavior (append + tools
 * available + MCP wired). Only the widget builder modal opts in.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const {
  buildClaudeCliArgs,
  resolveLockdownCwd,
  resolveLockdownPluginDir,
  LOCKDOWN_DISALLOWED_TOOLS,
  E2E_LAST_SPAWN_LOG_PATH,
} = require("./cliController");

describe("buildClaudeCliArgs — defaults preserve AssistantPanel behavior", () => {
  it("uses --append-system-prompt when systemPrompt is provided", () => {
    const args = buildClaudeCliArgs({ systemPrompt: "hello" });
    const idx = args.indexOf("--append-system-prompt");
    assert.notEqual(idx, -1, "--append-system-prompt should be present");
    assert.equal(args[idx + 1], "hello");
    assert.equal(
      args.includes("--system-prompt"),
      false,
      "--system-prompt (replace) must NOT be used by default",
    );
  });

  it("does NOT include --tools by default (built-in tools stay available)", () => {
    const args = buildClaudeCliArgs({ systemPrompt: "x" });
    assert.equal(args.includes("--tools"), false);
  });

  it("includes the standard --disable-slash-commands and --permission-mode bypassPermissions", () => {
    const args = buildClaudeCliArgs({ systemPrompt: "x" });
    assert.ok(args.includes("--disable-slash-commands"));
    const pmIdx = args.indexOf("--permission-mode");
    assert.notEqual(pmIdx, -1);
    assert.equal(args[pmIdx + 1], "bypassPermissions");
  });

  it("appends --model when model is provided", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      model: "claude-opus-4-7",
    });
    const idx = args.indexOf("--model");
    assert.notEqual(idx, -1);
    assert.equal(args[idx + 1], "claude-opus-4-7");
  });

  it("appends --resume when sessionId is provided", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      sessionId: "abc-123",
    });
    const idx = args.indexOf("--resume");
    assert.notEqual(idx, -1);
    assert.equal(args[idx + 1], "abc-123");
  });
});

describe("buildClaudeCliArgs — replaceSystemPrompt locks out the default Claude Code preamble", () => {
  it("uses --system-prompt instead of --append-system-prompt when replaceSystemPrompt: true", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "modal prompt",
      replaceSystemPrompt: true,
    });
    const idx = args.indexOf("--system-prompt");
    assert.notEqual(idx, -1, "--system-prompt should be present");
    assert.equal(args[idx + 1], "modal prompt");
    assert.equal(
      args.includes("--append-system-prompt"),
      false,
      "must NOT also use --append-system-prompt — that would defeat the purpose",
    );
  });
});

describe("buildClaudeCliArgs — disableTools blocks every built-in tool", () => {
  it('appends --tools "" when disableTools: true', () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: true,
    });
    const idx = args.indexOf("--tools");
    assert.notEqual(idx, -1, "--tools should be present");
    assert.equal(
      args[idx + 1],
      "",
      "the value should be empty-string, which the CLI documents as 'disable all tools'",
    );
  });

  it("does NOT include --tools when disableTools: false", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: false,
    });
    assert.equal(args.includes("--tools"), false);
  });
});

/**
 * Why this exists: `--tools ""` alone is not enough. In 2.1.138 of the
 * Claude Code CLI we saw the Skill tool fire despite `--tools ""`, and
 * the AI mention "your Dash Electron dashboard" + `mcp__dash__*` tool
 * names by name — context that came from the user's global
 * ~/.claude/CLAUDE.md and ~/.claude/projects/<project>/memory/, not
 * from cwd or our system prompt.
 *
 * `--bare` is documented as "skip hooks, LSP, plugin sync, attribution,
 * auto-memory, background prefetches, keychain reads, and CLAUDE.md
 * auto-discovery." It also disables the auto-load of user-installed
 * skills. Paired with `--strict-mcp-config` (which suppresses every
 * MCP server we don't explicitly pass via --mcp-config), this gives
 * the spawned CLI exactly the context we hand it via --system-prompt
 * and nothing more. The widget builder modal wants exactly that.
 *
 * Defaults must NOT include these flags — the AssistantPanel path
 * relies on CLAUDE.md / auto-memory / user MCPs being available.
 */
describe("buildClaudeCliArgs — disableTools also strips ambient context", () => {
  it("appends --bare when disableTools: true (kills CLAUDE.md auto-discovery, auto-memory, plugin sync)", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: true,
    });
    assert.ok(
      args.includes("--bare"),
      "--bare should be present so global ~/.claude/CLAUDE.md and project memory don't leak in",
    );
  });

  it("appends --strict-mcp-config when disableTools: true (kills user MCP auto-discovery)", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: true,
    });
    assert.ok(
      args.includes("--strict-mcp-config"),
      "--strict-mcp-config should be present so the AI doesn't see mcp__* tool names from user-level MCPs",
    );
  });

  it("does NOT include --bare or --strict-mcp-config when disableTools: false", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: false,
    });
    assert.equal(
      args.includes("--bare"),
      false,
      "AssistantPanel path needs CLAUDE.md + auto-memory + plugins",
    );
    assert.equal(
      args.includes("--strict-mcp-config"),
      false,
      "AssistantPanel path uses user-level MCPs",
    );
  });
});

/**
 * Why this exists: end-to-end smoke testing the slice 17f flag set
 * (`--tools "" --bare --strict-mcp-config --disable-slash-commands`)
 * against a real `claude -p` invocation revealed that user-installed
 * SKILLS and PLUGINS still load. The init-line of `--output-format
 * stream-json --verbose` shows tools/mcp/slash_commands all empty,
 * but `skills:` and `plugins:` remain populated. The Skill TOOL
 * survives because it's loaded from `~/.claude/plugins/`, not from
 * the built-in tools list that `--tools ""` controls.
 *
 * Two more layers seal this off:
 *   1. `--disallowed-tools "<comma-separated denylist>"` — explicitly
 *      deny Skill, Bash, Read, etc. by name. Comma-separated value
 *      (rather than space-separated) so the single-arg string has no
 *      whitespace — no Windows shell-quoting risk.
 *   2. `--plugin-dir <empty scratch dir>` — point at an empty dir
 *      under os.tmpdir() so plugin discovery finds nothing. The dir
 *      is a sibling of the scratch cwd from slice 17e.
 */
describe("buildClaudeCliArgs — disableTools also denies the Skill tool by name + points plugin discovery at an empty dir", () => {
  it("appends --disallowed-tools with a comma-separated denylist when disableTools: true", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: true,
    });
    const idx = args.indexOf("--disallowed-tools");
    assert.notEqual(idx, -1, "--disallowed-tools should be present");
    const value = args[idx + 1];
    assert.equal(typeof value, "string");
    // Comma-separated, NOT space-separated — Windows-safe.
    assert.ok(
      !/\s/.test(value),
      `denylist must contain no whitespace; got "${value}"`,
    );
    // Spot-check the must-deny names.
    for (const name of ["Skill", "Bash", "Read", "Edit", "Write"]) {
      assert.ok(
        value.split(",").includes(name),
        `denylist should include ${name}; got "${value}"`,
      );
    }
  });

  it("appends --plugin-dir pointing at a scratch dir under os.tmpdir() when disableTools: true", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: true,
    });
    const idx = args.indexOf("--plugin-dir");
    assert.notEqual(idx, -1, "--plugin-dir should be present");
    const dir = args[idx + 1];
    const rel = path.relative(os.tmpdir(), dir);
    assert.ok(
      !rel.startsWith(".."),
      `plugin-dir should live under os.tmpdir(); got ${dir}`,
    );
  });

  it("does NOT include --disallowed-tools or --plugin-dir when disableTools: false", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: false,
    });
    assert.equal(
      args.includes("--disallowed-tools"),
      false,
      "AssistantPanel needs Skill/Bash/etc — must not deny",
    );
    assert.equal(
      args.includes("--plugin-dir"),
      false,
      "AssistantPanel uses user plugins",
    );
  });

  it("LOCKDOWN_DISALLOWED_TOOLS exports the canonical denylist (comma-separated)", () => {
    assert.equal(typeof LOCKDOWN_DISALLOWED_TOOLS, "string");
    assert.ok(!/\s/.test(LOCKDOWN_DISALLOWED_TOOLS));
    assert.ok(LOCKDOWN_DISALLOWED_TOOLS.split(",").includes("Skill"));
  });
});

/**
 * Why this exists: the slice 18a diagnostic revealed that the
 * lockdown chain (ChatCore → IPC → cliController) silently dropped
 * `disableTools` and `replaceSystemPrompt` for months. Without an
 * argv assertion in the e2e test, the next break would be invisible
 * until a user filed a bug. The e2e-gated capture (only writes when
 * DASH_E2E=1) makes the e2e test a deterministic regression catch
 * for the chain.
 *
 * Production: env var is never set; capture is a no-op.
 * E2E: helper sets DASH_E2E=1; capture writes; test reads + asserts.
 */
describe("E2E_LAST_SPAWN_LOG_PATH — e2e-gated argv capture", () => {
  it("path is under os.tmpdir() and named dash-cli-last-spawn.e2e.json", () => {
    const rel = path.relative(os.tmpdir(), E2E_LAST_SPAWN_LOG_PATH);
    assert.ok(
      !rel.startsWith(".."),
      `must live under os.tmpdir(); got ${E2E_LAST_SPAWN_LOG_PATH}`,
    );
    assert.ok(E2E_LAST_SPAWN_LOG_PATH.endsWith("dash-cli-last-spawn.e2e.json"));
  });

  // The capture function is internal (gated on process.env.DASH_E2E)
  // and not exported. Behavioral tests for its production-no-op
  // contract belong in the e2e suite where the env var is set;
  // unit-testing the no-op is straightforward — we just confirm the
  // file path constant and rely on the e2e to verify the write.
});

describe("resolveLockdownPluginDir — scratch plugin dir for the widget-builder lockdown", () => {
  it("returns the explicit pluginDir unchanged when caller passes one", () => {
    const out = resolveLockdownPluginDir({
      pluginDir: "/explicit/plugins",
      disableTools: true,
    });
    assert.equal(out, "/explicit/plugins");
  });

  it("falls back to a scratch dir under os.tmpdir() when disableTools: true and pluginDir is absent", () => {
    const out = resolveLockdownPluginDir({ disableTools: true });
    assert.ok(typeof out === "string" && out.length > 0);
    const rel = path.relative(os.tmpdir(), out);
    assert.ok(
      !rel.startsWith(".."),
      `plugin-dir should live under os.tmpdir(); got ${out}`,
    );
  });

  it("returns null when not in lockdown and no pluginDir was passed", () => {
    const out = resolveLockdownPluginDir({});
    assert.equal(out, null);
  });

  it("scratch dir is stable across calls", () => {
    const a = resolveLockdownPluginDir({ disableTools: true });
    const b = resolveLockdownPluginDir({ disableTools: true });
    assert.equal(a, b);
  });

  it("scratch plugin dir is DIFFERENT from scratch cwd (so plugin discovery doesn't sweep cwd)", () => {
    const cwdDir = resolveLockdownCwd({ disableTools: true });
    const pluginDir = resolveLockdownPluginDir({ disableTools: true });
    assert.notEqual(cwdDir, pluginDir);
  });
});

describe("buildClaudeCliArgs — combined widget-builder lockdown", () => {
  it("widget-builder invocation: replace prompt + disable tools together", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "widget builder prompt",
      replaceSystemPrompt: true,
      disableTools: true,
    });

    // System prompt is REPLACED (not appended)
    assert.ok(args.includes("--system-prompt"));
    assert.equal(args.includes("--append-system-prompt"), false);

    // Tools are disabled
    const toolsIdx = args.indexOf("--tools");
    assert.notEqual(toolsIdx, -1);
    assert.equal(args[toolsIdx + 1], "");

    // Ambient-context suppression
    assert.ok(args.includes("--bare"));
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(args.includes("--disallowed-tools"));
    assert.ok(args.includes("--plugin-dir"));

    // Standard safety flags still in place
    assert.ok(args.includes("--disable-slash-commands"));
    assert.ok(args.includes("--permission-mode"));
  });
});

/**
 * Why this exists: when the widget-builder modal launches the CLI
 * with disableTools+replaceSystemPrompt, the spawned process inherits
 * the parent (Electron) process cwd by default. For a dev build that
 * means the dash-electron project root, which contains a CLAUDE.md
 * full of project-development protocol. The CLI auto-loads that file
 * as project context, and the AI announces "Let me start by scanning
 * the existing project to understand what's already here." — exactly
 * the behavior the lockdown was meant to prevent.
 *
 * Fix: when the caller is in lockdown mode (`disableTools: true`) and
 * has not passed an explicit `cwd`, route the child to a scratch
 * directory under os.tmpdir() that has no CLAUDE.md and no project
 * files. The AI starts cold — no project to "scan."
 */
describe("resolveLockdownCwd — scratch cwd for the widget-builder lockdown", () => {
  it("returns the explicit cwd unchanged when caller passes one", () => {
    const out = resolveLockdownCwd({
      cwd: "/explicit/path",
      disableTools: true,
    });
    assert.equal(out, "/explicit/path");
  });

  it("falls back to a scratch dir under os.tmpdir() when disableTools: true and cwd is absent", () => {
    const out = resolveLockdownCwd({ disableTools: true });
    assert.ok(typeof out === "string" && out.length > 0);
    const rel = path.relative(os.tmpdir(), out);
    assert.ok(
      !rel.startsWith(".."),
      `cwd should live under os.tmpdir(); got ${out}`,
    );
  });

  it("returns null when not in lockdown and no cwd was passed (preserves AssistantPanel behavior — child inherits parent cwd)", () => {
    const out = resolveLockdownCwd({});
    assert.equal(out, null);
  });

  it("explicit cwd wins even outside lockdown", () => {
    const out = resolveLockdownCwd({ cwd: "/explicit/path" });
    assert.equal(out, "/explicit/path");
  });

  it("scratch dir is stable across calls (so we don't churn tmpdir entries)", () => {
    const a = resolveLockdownCwd({ disableTools: true });
    const b = resolveLockdownCwd({ disableTools: true });
    assert.equal(a, b);
  });
});

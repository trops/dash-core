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
const { buildClaudeCliArgs } = require("./cliController");

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

    // Standard safety flags still in place
    assert.ok(args.includes("--disable-slash-commands"));
    assert.ok(args.includes("--permission-mode"));
  });
});

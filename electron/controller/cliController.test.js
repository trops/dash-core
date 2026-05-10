/**
 * Pins the CLI args produced by cliController for the
 * Claude Code child process.
 *
 * Two relevant axes for the modal vs the AssistantPanel:
 *   1. `replaceSystemPrompt` — modal opts in to `--system-prompt`
 *      (replace) so its terse "use the dash-widget-builder skill"
 *      prompt isn't drowned out by Claude Code's default preamble.
 *      AssistantPanel keeps the default (append).
 *   2. `disableTools` — survives as a prop for backwards
 *      compatibility with existing callers; no longer adds any CLI
 *      flag (slice 19B dropped the flag-based lockdown after
 *      switching to skill-driven prompting). Still gates the dash
 *      MCP auto-wire downstream of buildClaudeCliArgs.
 *
 * Defaults preserve the AssistantPanel behavior (append + skill /
 * plugin / CLAUDE.md auto-load + MCP wired).
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

describe("buildClaudeCliArgs — replaceSystemPrompt swaps append for replace", () => {
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

/**
 * Slice 19B removed the flag-based lockdown — the project's
 * dash-widget-builder skill (auto-loaded when the modal sets
 * cwd=projectRoot) carries the same constraints more reliably than
 * we ever managed via flag wrangling. The `disableTools` prop is
 * still in the signature for backwards compatibility, but it must
 * now produce identical argv whether true or false. The flag still
 * gates the dash-MCP auto-wire downstream — that's the only
 * remaining behavior, and it's tested in the integration path.
 */
describe("buildClaudeCliArgs — disableTools is a no-op for argv (slice 19B)", () => {
  it("does NOT add any flags when disableTools: true", () => {
    const argsTrue = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: true,
    });
    const argsFalse = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: false,
    });
    assert.deepEqual(argsTrue, argsFalse);
  });

  it("does NOT include any of the dropped lockdown flags regardless of disableTools", () => {
    const args = buildClaudeCliArgs({
      systemPrompt: "x",
      disableTools: true,
    });
    for (const removed of [
      "--tools",
      "--bare",
      "--strict-mcp-config",
      "--disallowed-tools",
      "--plugin-dir",
    ]) {
      assert.equal(
        args.includes(removed),
        false,
        `${removed} must not be in argv — slice 19B dropped the lockdown stack`,
      );
    }
  });
});

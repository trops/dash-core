/**
 * ChatCore — lockdown prop forwarding (slice 18b).
 *
 * Why this exists: a full day was lost diagnosing a "lockdown bypassed"
 * bug whose root cause was that `WidgetBuilderModal` set
 * `replaceSystemPrompt={true}` and `disableTools={true}` on this
 * component, but this component (the canonical dash-core ChatCore the
 * modal imports from `@trops/dash-core`) did NOT destructure those
 * props from its signature, nor include them in its
 * `mainApi.llm.sendMessage` payload. The flags went straight to
 * /dev/null and the cliController fell through to its non-lockdown
 * defaults — Skill / Bash / etc. fired despite the modal explicitly
 * asking them to be disabled.
 *
 * Static source inspection (matches the ChatCore-no-end-session test
 * pattern in this same directory). A full RTL render would need to
 * mock the entire `mainApi.llm` listener surface
 * (onStreamStart/Delta/End/Error/ToolUse/...), which is out of scope
 * here. The static asserts catch the chain break immediately if it
 * reappears.
 */
const fs = require("fs");
const path = require("path");

describe("ChatCore — lockdown props are forwarded to mainApi.llm.sendMessage", () => {
  const source = fs.readFileSync(path.join(__dirname, "ChatCore.js"), "utf8");

  test("destructures `replaceSystemPrompt` from props with default `false`", () => {
    // The default = false matters: AssistantPanel and every other
    // existing consumer doesn't pass this prop, and the AssistantPanel
    // path explicitly RELIES on Claude Code's default preamble (which
    // advertises tools). Defaulting to true would silently break that
    // panel.
    expect(source).toMatch(/replaceSystemPrompt\s*=\s*false/);
  });

  test("destructures `disableTools` from props with default `false`", () => {
    expect(source).toMatch(/disableTools\s*=\s*false/);
  });

  test("includes `replaceSystemPrompt` in the mainApi.llm.sendMessage payload", () => {
    // Match a `replaceSystemPrompt[,\n]` after the sendMessage opening
    // so we know it's in the payload object, not just a destructure.
    const idx = source.indexOf("mainApi.llm.sendMessage");
    expect(idx).toBeGreaterThan(-1);
    // Take a slice up to ~20 lines past the call to scope the match.
    const tail = source.slice(idx, idx + 1500);
    expect(tail).toMatch(/replaceSystemPrompt[,\n}]/);
  });

  test("includes `disableTools` in the mainApi.llm.sendMessage payload", () => {
    const idx = source.indexOf("mainApi.llm.sendMessage");
    expect(idx).toBeGreaterThan(-1);
    const tail = source.slice(idx, idx + 1500);
    expect(tail).toMatch(/disableTools[,\n}]/);
  });
});

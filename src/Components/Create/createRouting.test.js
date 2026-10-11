import {
  CREATE_TYPES,
  canSend,
  noAiOptions,
  normalizeCreateType,
  routeCreate,
} from "./createRouting";

describe("createRouting (create-entry PRD CRE-001/005)", () => {
  test("Widget and Bot can be picked; Dashboard and Theme say why not yet", () => {
    const byValue = Object.fromEntries(CREATE_TYPES.map((t) => [t.value, t]));
    expect(byValue.widget.disabled).toBeFalsy();
    expect(byValue.bot.disabled).toBeFalsy();
    expect(byValue.dashboard.disabled).toBe(true);
    expect(byValue.dashboard.hint).toMatch(/without AI/);
    expect(byValue.theme.disabled).toBe(true);
    expect(byValue.theme.hint).toMatch(/New theme/);
  });

  test("normalizeCreateType falls back to Widget for anything not pickable", () => {
    expect(normalizeCreateType("bot")).toBe("bot");
    expect(normalizeCreateType("widget")).toBe("widget");
    expect(normalizeCreateType("dashboard")).toBe("widget");
    expect(normalizeCreateType(undefined)).toBe("widget");
  });

  test("the no-AI row always offers dashboards and a theme, plus the type's own", () => {
    const keys = (type) => noAiOptions(type).map((o) => o.key);
    const common = [
      "blank-dashboard",
      "import-dashboard",
      "browse-dashboards",
      "new-theme",
    ];
    expect(keys("widget")).toEqual([
      "browse-widgets",
      "widget-zip",
      "widget-folder",
      ...common,
    ]);
    expect(keys("bot")).toEqual(["blank-bot", ...common]);
  });

  test("Send needs a prompt; a widget also needs an AI, a bot doesn't", () => {
    expect(
      canSend({ type: "widget", prompt: "  ", aiBackend: "claude-code" }),
    ).toBe(false);
    expect(canSend({ type: "widget", prompt: "Inbox", aiBackend: null })).toBe(
      false,
    );
    expect(
      canSend({ type: "widget", prompt: "Inbox", aiBackend: "anthropic" }),
    ).toBe(true);
    expect(canSend({ type: "bot", prompt: "Summarize", aiBackend: null })).toBe(
      true,
    );
    expect(
      canSend({ type: "dashboard", prompt: "x", aiBackend: "claude-code" }),
    ).toBe(false);
  });

  test("Widget opens the builder with the prompt; Bot opens the form with it as instructions", () => {
    expect(routeCreate({ type: "widget", prompt: "  Show my PRs " })).toEqual({
      kind: "widget-builder",
      detail: { prompt: "Show my PRs" },
    });
    expect(
      routeCreate({
        type: "bot",
        prompt: "Summarize my inbox",
        workspaceId: 7,
      }),
    ).toEqual({
      kind: "bot-form",
      bot: { instructions: "Summarize my inbox" },
      workspaceId: 7,
    });
    expect(routeCreate({ type: "theme", prompt: "x" })).toBeNull();
  });
});

import {
  CREATE_TYPES,
  createTypes,
  canSend,
  draftAge,
  noAiOptions,
  normalizeCreateType,
  routeCreate,
} from "./createRouting";

describe("createRouting (create-entry PRD CRE-001/005)", () => {
  test("Widget, Bot and Dashboard can be picked; Theme says why not yet", () => {
    const byValue = Object.fromEntries(CREATE_TYPES.map((t) => [t.value, t]));
    expect(byValue.widget.disabled).toBeFalsy();
    expect(byValue.bot.disabled).toBeFalsy();
    expect(byValue.dashboard.disabled).toBeFalsy();
    expect(byValue.theme.disabled).toBe(true);
    expect(byValue.theme.hint).toMatch(/New theme/);
  });

  test("normalizeCreateType falls back to Widget for anything not pickable", () => {
    expect(normalizeCreateType("bot")).toBe("bot");
    expect(normalizeCreateType("widget")).toBe("widget");
    expect(normalizeCreateType("theme")).toBe("widget");
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
    // The Planner runs on its own model source (phase 4a).
    expect(canSend({ type: "dashboard", prompt: "x", aiBackend: null })).toBe(
      true,
    );
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

  test("draftAge reads like a list timestamp", () => {
    const now = 1_000_000_000_000;
    expect(draftAge(now - 10_000, now)).toBe("just now");
    expect(draftAge(now - 5 * 60_000, now)).toBe("5m ago");
    expect(draftAge(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(draftAge(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(draftAge(undefined, now)).toMatch(/d ago$/);
  });
});

describe("Type: Dashboard (phase 4a; on for everyone since 4d-3)", () => {
  test("offered without a setting, no longer a preview", () => {
    const dash = createTypes().find((t) => t.value === "dashboard");
    expect(dash.disabled).toBeFalsy();
    expect(dash.description).not.toMatch(/preview/);
    expect(normalizeCreateType("dashboard")).toBe("dashboard");
  });

  test("Send opens the Planner with the prompt", () => {
    expect(
      routeCreate({ type: "dashboard", prompt: " A morning brief " }),
    ).toEqual({
      kind: "dashboard-plan",
      detail: { prompt: "A morning brief" },
    });
  });
});

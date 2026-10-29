/**
 * A widget's Change with AI as a conversation (lead-workspace release 6c,
 * frame 40): what it says and tells the lead, its plan (settings only, or
 * what it does), what changes, the build's options and words.
 */
import { widgetStart, makingAbout } from "./workspaceStart";
import {
  fitsWidget,
  isSettingsChange,
  planForWidget,
  planLine,
  planName,
  settingsChanged,
  widgetBuildPlan,
  yesLabel,
} from "./workspacePlan";
import { buildChat, buildKind, buildOptions } from "./workspaceBuild";
import { widgetChanges } from "./planChanges";

const DOOR = {
  component: "trops.weather.Weather",
  sourcePackage: "@trops/weather",
  itemId: 12,
  workspaceId: 7,
  pageId: "p1",
  scope: "main",
  gridItemId: 3,
  cellNumber: "1.2",
  settings: { units: "f" },
  providers: null,
  error: "",
};
const TARGET = {
  component: "trops.weather.Weather",
  componentName: "Weather",
  displayName: "Weather",
  package: "@trops/weather",
  config: {
    userConfig: {
      units: { displayName: "Units", defaultValue: "f" },
      days: { displayName: "Forecast", defaultValue: 5 },
    },
  },
};
const start = (over = {}, door = DOOR) =>
  widgetStart(door, {
    target: TARGET,
    mode: "new",
    usedOn: ["Kitchen Sink"],
    dashboardName: "Kitchen Sink",
    leadName: "Kitchen Sink Lead",
    ...over,
  });

describe("what it says and tells the lead", () => {
  test("Changing: that widget, on its dashboard", () => {
    const s = start();
    expect(s.label).toBe("Changing");
    expect(s.text).toBe("Weather — on Kitchen Sink");
    expect(s.title).toBe("What should change in Weather?");
    expect(s.starters[0]).toBe("Change its settings");
  });

  test("the note: read it, a settings-only change is a settings piece, else a new widget in its place", () => {
    const { note } = start();
    expect(note).toMatch(/read_widget/);
    expect(note).toMatch(
      /units \(now f\), days \(now 5\) — plan one widget piece \{"kind": "widget", "name": "Weather", "source": "settings"/,
    );
    expect(note).toMatch(
      /Otherwise the change is saved as a new widget — Weather stays as it is: its piece is source "new" with a new name, and it takes this copy's place on Kitchen Sink\./,
    );
  });

  test("a widget with no settings: no settings promise, no settings starter", () => {
    const s = start({ target: { ...TARGET, config: { userConfig: {} } } });
    expect(s.greeting).not.toMatch(/settings/);
    expect(s.starters).not.toContain("Change its settings");
    expect(s.note).not.toMatch(/"source": "settings"/);
  });

  test("in place: everywhere it's used", () => {
    const s = start({ mode: "update", usedOn: ["Kitchen Sink", "Home"] });
    expect(s.note).toMatch(
      /the change goes into Weather itself \(in place\), which is on Kitchen Sink and Home: its piece is source "update" with package "@trops\/weather"/,
    );
    expect(s.greeting).toMatch(
      /Weather changes everywhere it's used \(Kitchen Sink and Home\)\./,
    );
  });

  test("from the Widgets page: no dashboard, no settings change", () => {
    const s = start({}, { ...DOOR, itemId: null, workspaceId: null });
    expect(s.text).toBe("Weather");
    expect(s.note).not.toMatch(/"source": "settings"/);
    expect(s.note).toMatch(/\. The change is saved as a new widget/);
    expect(s.widget.onDashboard).toBe(false);
  });

  test("from the error box: fix it, with the error", () => {
    const s = start({}, { ...DOOR, error: "x is undefined" });
    expect(s.starters).toEqual(["Fix the error so it works again"]);
    expect(s.note).toMatch(/quoted from the app: "x is undefined"/);
  });

  test("saved with the conversation: the widget, its settings now and their names", () => {
    const about = makingAbout(start());
    expect(about.widget).toMatchObject({
      component: "trops.weather.Weather",
      displayName: "Weather",
      mode: "new",
      onDashboard: true,
      itemId: 12,
      workspaceId: 7,
      settingsNow: { units: "f", days: 5 },
      settingLabels: { units: "Units", days: "Forecast" },
    });
  });
});

const W = start().widget;
const SETTINGS = {
  summary: "°C, 3 days",
  dashboard: { id: "7", name: "Kitchen Sink" },
  pieces: [
    {
      kind: "widget",
      name: "Weather",
      source: "settings",
      settings: { units: "c", days: 3 },
    },
  ],
};
const CODE = {
  summary: "Hourly too",
  pieces: [{ kind: "widget", name: "Weather Hourly", source: "new" }],
};

describe("its plan", () => {
  test("a settings change: for that dashboard; 2 settings change; Yes, change it", () => {
    const p = planForWidget(SETTINGS, W);
    expect(isSettingsChange(p)).toBe(true);
    expect(settingsChanged(p)).toEqual(["units", "days"]);
    expect(p.dashboard).toEqual({ id: "7", name: "Kitchen Sink" });
    expect(planName(p)).toBe("Weather");
    expect(planLine(p)).toBe("Plan · 2 settings change");
    expect(yesLabel(p)).toBe("Yes, change it");
    expect(buildKind(p)).toBe("settings");
    expect(buildOptions("settings", p)).toEqual({
      settings: {
        workspaceId: 7,
        itemId: 12,
        pageId: "p1",
        scope: "main",
        component: "trops.weather.Weather",
        displayName: "Weather",
      },
    });
    expect(widgetBuildPlan(p)).toEqual({
      summary: SETTINGS.summary,
      pieces: SETTINGS.pieces,
    });
  });

  test("a change to what it does: no dashboard; the Builder; built as an edit", () => {
    const p = planForWidget({ ...CODE, dashboard: { id: "7", name: "K" } }, W);
    expect(p.dashboard).toBeUndefined();
    expect(planLine(p)).toBe("Plan · a change to what it does");
    expect(buildKind(p)).toBe("edit");
    expect(buildOptions("edit", p)).toEqual({
      edit: {
        component: "trops.weather.Weather",
        mode: "new",
        displayName: "Weather",
        settings: { units: "f", days: 5 },
        providers: null,
      },
    });
  });

  test("more than the widget: doesn't fit, flagged", () => {
    const p = planForWidget(
      { ...CODE, pieces: [...CODE.pieces, { kind: "bot", name: "B" }] },
      W,
    );
    expect(fitsWidget(p)).toBe(false);
    expect(planLine(p)).toBe("Plan · more than this widget");
    const c = widgetChanges(p);
    expect(c.fits).toBe(false);
    expect(c.rows.map((r) => r.mark)).toEqual(["!", "!"]);
  });
});

describe("what changes", () => {
  test("its settings, old → new; place and size unchanged", () => {
    const c = widgetChanges(planForWidget(SETTINGS, W));
    expect(c.rows.map((r) => r.main)).toEqual([
      "Units — f → c",
      "Forecast — 5 → 3",
      "Place and size — unchanged",
    ]);
  });

  test("what it does: the Builder, then where it goes", () => {
    const c = widgetChanges(planForWidget(CODE, W));
    expect(c.rows.map((r) => r.main)).toEqual([
      "What it does — the Builder changes it",
      "A new widget — Weather stays as it is",
    ]);
    expect(c.rows[1].sub).toBe("It takes this copy's place on Kitchen Sink");
  });
});

describe("its build in the chat", () => {
  test("settings: changed on its dashboard, which ones", () => {
    const c = buildChat(
      {
        status: "done",
        dashboard: { id: "7", name: "Kitchen Sink", targeted: true },
        steps: [
          {
            kind: "settings",
            status: "done",
            label: "Change Weather's settings",
            detail: "units, days",
          },
        ],
      },
      { kind: "settings", change: W },
    );
    expect(c.reply).toBe(
      "Weather's settings are changed on Kitchen Sink: Units and Forecast. Only this copy changed.",
    );
    expect(c.card.sub).toBe("Settings · 2 changes");
    expect(c.choices).toBe("open");
  });

  const DONE = {
    status: "done",
    steps: [
      { kind: "build", status: "done", label: "Write the change into a draft" },
      { kind: "save", status: "done", label: "Install Weather Hourly" },
    ],
  };
  test("in place: updated everywhere", () => {
    const c = buildChat(DONE, {
      kind: "edit",
      change: { ...W, mode: "update" },
    });
    expect(c.reply).toMatch(/^Weather is updated — everywhere it's used/);
  });

  test("a new one in its place: placed, or why not, with Put it in its place", () => {
    const at = (placed) =>
      buildChat(DONE, {
        kind: "edit",
        change: { ...W, placed, canPlace: true },
      });
    expect(at(true).reply).toBe(
      "Weather Hourly is in Weather's place on Kitchen Sink. Save Kitchen Sink to keep it.",
    );
    expect(at(true).choices).toBeNull();
    expect(at("preview").reply).toMatch(/Kitchen Sink isn't being edited/);
    expect(at("preview").choices).toBe("swap");
    expect(at("gone").choices).toBeNull();
    expect(at(undefined).choices).toBe("swap");
  });

  test("from the Widgets page: in your widgets", () => {
    const c = buildChat(DONE, {
      kind: "edit",
      change: { ...W, onDashboard: false },
    });
    expect(c.reply).toMatch(
      /^Weather Hourly is in your widgets — Weather stays/,
    );
  });

  test("its preview says what happens next", () => {
    const c = buildChat(
      {
        status: "waiting-for-you",
        steps: [
          { kind: "preview", label: "Preview Weather", status: "needs-you" },
        ],
      },
      { kind: "edit", change: { ...W, mode: "update" } },
    );
    expect(c.reply).toMatch(/before Weather changes everywhere it's used\.$/);
  });
});

describe("review fixes", () => {
  test("a key or token keeps its value out of the note and the saved conversation", () => {
    const s = widgetStart(
      { ...DOOR, settings: { apiKey: "sk-123456", units: "c" } },
      {
        target: {
          ...TARGET,
          config: {
            userConfig: {
              apiKey: { displayName: "API key" },
              units: { displayName: "Units" },
            },
          },
        },
        mode: "new",
        dashboardName: "Kitchen Sink",
      },
    );
    expect(s.note).not.toMatch(/sk-123456/);
    expect(s.note).toMatch(/apiKey \(set — not shown\), units \(now c\)/);
    expect(s.widget.settingsNow).toEqual({ units: "c" });
  });

  test("a choice shows its label, not its value", () => {
    const s = widgetStart(DOOR, {
      target: {
        ...TARGET,
        config: {
          userConfig: {
            units: {
              displayName: "Units",
              options: [
                { value: "f", displayName: "Fahrenheit" },
                { value: "c", displayName: "Celsius" },
              ],
            },
          },
        },
      },
      mode: "new",
      dashboardName: "Kitchen Sink",
    });
    const c = widgetChanges(
      planForWidget(
        {
          summary: "°C",
          pieces: [
            {
              kind: "widget",
              name: "W",
              source: "settings",
              settings: { units: "c" },
            },
          ],
        },
        s.widget,
      ),
    );
    expect(c.rows[0].main).toBe("Units — Fahrenheit → Celsius");
  });

  test("a setting it doesn't have is flagged", () => {
    const c = widgetChanges(
      planForWidget(
        {
          summary: "x",
          pieces: [
            {
              kind: "widget",
              name: "W",
              source: "settings",
              settings: { colour: "red" },
            },
          ],
        },
        W,
      ),
    );
    expect(c.rows[0]).toMatchObject({
      mark: "!",
      main: "colour — Weather has no setting by that name",
    });
  });

  test("from the Widgets page a settings change doesn't fit", () => {
    const p = planForWidget(SETTINGS, { ...W, onDashboard: false });
    expect(fitsWidget(p)).toBe(false);
    expect(widgetChanges(p).fits).toBe(false);
  });

  test("where it's used, in words", () => {
    const c = widgetChanges(
      planForWidget(CODE, {
        ...W,
        mode: "update",
        usedOn: ["Kitchen Sink", "Home"],
      }),
    );
    expect(c.rows[1].sub).toBe("On Kitchen Sink and Home");
  });
});

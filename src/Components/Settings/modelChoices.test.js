import {
  choiceLabel,
  choiceNow,
  choiceText,
  familiesOf,
  followNewestRows,
  modelOptions,
  resolveModel,
  GROUP_EXACT,
  GROUP_LATEST,
} from "./modelChoices";
import { newModelText } from "./NewModelNotice";
import { moveLabel, movedText, usageRows } from "./RetiredModelNotice";
import { jobOfBot } from "../Issues/IssueModelChoice";
import { cheaperDefaults, listStatusText } from "./sections/aiSettingsText";

const MODELS = [
  {
    value: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    family: "opus",
    status: "current",
    tier: "deep",
  },
  {
    value: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    family: "sonnet",
    status: "current",
    tier: "balanced",
  },
  {
    value: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    family: "haiku",
    status: "current",
    tier: "fast",
  },
  {
    value: "claude-fable-5-2",
    label: "Claude Fable 5.2",
    family: "fable",
    status: "current",
    tier: "deep",
  },
  {
    value: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    family: "fable",
    status: "older",
    tier: "deep",
  },
  {
    value: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    family: "opus",
    status: "retiring",
    retiresOn: "2027-03-01",
    tier: "deep",
  },
  {
    value: "claude-old-1",
    label: "Claude Old 1",
    family: "old",
    status: "retired",
  },
];

describe("modelChoices", () => {
  test("Latest <family> is the newest model of it that still runs", () => {
    expect(resolveModel(MODELS, "latest:fable").value).toBe("claude-fable-5-2");
    expect(resolveModel(MODELS, "latest:old")).toBeNull();
    expect(choiceLabel(MODELS, "latest:haiku")).toBe("Latest Haiku");
    expect(choiceNow(MODELS, "latest:haiku")).toBe("now Haiku 5.5");
    expect(choiceText(MODELS, "latest:haiku")).toBe(
      "Latest Haiku, now Haiku 5.5",
    );
    expect(choiceLabel(MODELS, "claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(choiceNow(MODELS, "claude-sonnet-5-5")).toBe("exact version");
    expect(choiceNow(MODELS, "claude-gone")).toBe("not offered any more");
  });

  test("families come in their usual order, retired ones left out", () => {
    expect(familiesOf(MODELS)).toEqual(["opus", "sonnet", "haiku", "fable"]);
  });

  test("the picker: Follows the newest, then each version that still runs", () => {
    const opts = modelOptions(MODELS, {
      newIds: ["claude-fable-5-2"],
      makeBadge: (kind, text) => `${kind}:${text}`,
    });
    const latest = opts.filter((o) => o.group === GROUP_LATEST);
    expect(
      latest.map((o) => [o.label, o.description, o.badge || null]),
    ).toEqual([
      ["Latest Opus", "now Opus 5.5 · most capable", null],
      ["Latest Sonnet", "now Sonnet 5.5 · balanced", null],
      ["Latest Haiku", "now Haiku 5.5 · fastest", null],
      ["Latest Fable", "now Fable 5.2", "info:New"],
    ]);
    const exact = opts.filter((o) => o.group === GROUP_EXACT);
    expect(exact.map((o) => o.value)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-2",
      "claude-fable-5-1",
      "claude-opus-4-8",
    ]);
    const opus48 = exact.find((o) => o.value === "claude-opus-4-8");
    expect(opus48).toMatchObject({
      muted: true,
      badge: "warning:Retiring",
      description: "older · goes away 2027-03-01",
    });
    expect(exact.find((o) => o.value === "claude-fable-5-1").muted).toBe(true);
  });

  test("a saved model the list no longer offers still shows, dimmed", () => {
    const opts = modelOptions(MODELS, { value: "claude-old-1" });
    expect(opts[opts.length - 1]).toMatchObject({
      value: "claude-old-1",
      label: "Old 1",
      description: "retired",
      muted: true,
    });
  });

  test("what the one-time question would move", () => {
    const rows = followNewestRows(
      {
        bots: { model: "claude-haiku-5-5" },
        planner: { model: "latest:opus" },
        builder: { model: "claude-opus-4-8" },
        scout: { model: null },
        checker: { model: "claude-gone" },
      },
      MODELS,
    );
    expect(rows).toEqual([
      {
        job: "bots",
        from: "claude-haiku-5-5",
        to: "latest:haiku",
        sameToday: true,
      },
      {
        job: "builder",
        from: "claude-opus-4-8",
        to: "latest:opus",
        sameToday: false,
      },
    ]);
  });

  test("cheaper defaults follow the newest of their family", () => {
    expect(cheaperDefaults(MODELS).bots).toEqual({
      model: "latest:haiku",
      style: "brief",
    });
  });

  test("the new-model notice says what moves to it", () => {
    const none = newModelText(MODELS, ["claude-fable-5-2"], {
      ai: {},
      bots: [],
    });
    expect(none.title).toBe("Claude Fable 5.2 is out");
    expect(none.message).toMatch(/Anything set to Latest Fable moves to it/);
    expect(none.message).toMatch(
      /None of your defaults, bots or widgets use Fable/,
    );
    const some = newModelText(MODELS, ["claude-fable-5-2"], {
      ai: { defaults: { planner: { model: "latest:fable" } } },
      bots: [{ id: "b", model: "latest:fable" }, { id: "c" }],
      widgetCount: () => 2,
    });
    expect(some.message).toMatch(
      /Moving to it: Create · Planner, 1 bot and 2 widgets\./,
    );
    expect(newModelText(MODELS, [], {})).toBeNull();
  });

  test("the list's status line", () => {
    const now = new Date(2026, 10, 15, 12, 0).getTime();
    const at = new Date(2026, 10, 15, 9, 12).getTime();
    expect(
      listStatusText({ checkedAt: at, error: null, added: [] }, now),
    ).toMatch(/^Model list up to date · checked today at /);
    expect(
      listStatusText({ checkedAt: at - 86400000, error: "x", added: [] }, now),
    ).toMatch(/^Last checked yesterday at .* · couldn't reach the list$/);
    expect(listStatusText({ checkedAt: null, error: "x" }, now)).toBe(
      "Couldn't reach the model list · using the one built in",
    );
    expect(
      listStatusText({ checkedAt: at, error: null, added: ["a"] }, now),
    ).toMatch(/^Model list updated today at /);
  });
});

test("what moved: Latest for all, or some on the exact version", () => {
  const usage = {
    model: "claude-sonnet-4-20250514",
    count: 3,
    kinds: { widget: 3 },
    dashboards: [],
  };
  expect(moveLabel(MODELS, "latest:sonnet")).toBe(
    "Latest Sonnet (now Sonnet 5.5)",
  );
  expect(moveLabel(MODELS, "claude-sonnet-5-5")).toBe("Sonnet 5.5");
  expect(
    movedText(MODELS, usage, {
      to: "latest:sonnet",
      dashboards: 2,
      failed: 0,
      exact: 1,
    }),
  ).toBe(
    "Moved 3 widgets on 2 dashboards from Claude Sonnet 4 to Latest Sonnet (now Sonnet 5.5). 1 widget lists exact versions, so it's on Sonnet 5.5.",
  );
  expect(
    movedText(MODELS, usage, {
      to: "latest:sonnet",
      dashboards: 2,
      failed: 0,
      exact: 0,
    }),
  ).toBe(
    "Moved 3 widgets on 2 dashboards from Claude Sonnet 4 to Latest Sonnet (now Sonnet 5.5).",
  );
});

test("rows: most widgets first", () => {
  const rows = usageRows({
    dashboards: [
      { workspaceId: 1, name: "A", count: 1 },
      { workspaceId: 2, name: "B", count: 2 },
      { workspaceId: 3, name: "B", count: 2 },
    ],
  });
  expect(rows.map((r) => r.name)).toEqual(["B (2 dashboards)", "A"]);
});

test("a bot's job, for its default", () => {
  expect(jobOfBot({ system: "dash-team", role: "planner" })).toBe("planner");
  expect(jobOfBot({ system: "dash-team", role: "dashlead" })).toBe("dashLead");
  expect(jobOfBot({ role: "lead" })).toBe("leads");
  expect(jobOfBot({})).toBe("bots");
});

test("rows from a profile that isn't open say so", () => {
  const rows = usageRows({
    dashboards: [
      { workspaceId: 1, name: "Kitchen Sink", count: 2, otherProfile: true },
      { workspaceId: 2, name: "Kitchen Sink", count: 1, otherProfile: true },
      { workspaceId: 3, name: "Home", count: 1, otherProfile: false },
    ],
  });
  expect(rows.map((r) => r.name)).toEqual([
    "Kitchen Sink (2 dashboards) · in another profile",
    "Home",
  ]);
});

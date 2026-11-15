import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AiAssistantSection, maskedKey } from "./AiAssistantSection";
import { AppContext } from "../../../Context/App/AppContext";

const MODELS = [
  {
    value: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    tier: "deep",
    pricing: { input: 4, output: 20 },
  },
  {
    value: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    tier: "balanced",
    pricing: { input: 2, output: 10 },
  },
  {
    value: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    tier: "fast",
    pricing: { input: 0.1, output: 0.5 },
  },
];

const LIMITS = {
  steps: 25,
  createSteps: 80,
  costPerRun: 1,
  minutes: 20,
  perBot: null,
};

function resolved(over = {}) {
  const defaults = {};
  for (const job of [
    "bots",
    "leads",
    "planner",
    "builder",
    "checker",
    "scout",
    "dashLead",
  ]) {
    defaults[job] = { model: null, style: null };
  }
  return {
    backend: "subscription",
    defaults,
    limits: { ...LIMITS },
    migrated: true,
    ...over,
  };
}

let botsApi;

function setup({ ai = resolved(), providers = {}, bots, llm = {} } = {}) {
  let current = ai;
  botsApi = {
    getSettings: jest.fn(async () => ({ aiResolved: current })),
    setSettings: jest.fn(async ({ ai: patch }) => {
      current = {
        ...current,
        ...(patch.backend ? { backend: patch.backend } : {}),
        defaults: { ...current.defaults, ...(patch.defaults || {}) },
        limits: { ...current.limits, ...(patch.limits || {}) },
      };
      return {};
    }),
    list: jest.fn(
      async () =>
        bots || [
          { id: "b1", name: "Agenda", subscriptions: [] },
          {
            id: "b2",
            name: "Recipe Bot",
            schedules: [{ cron: "0 8 * * 0" }],
          },
          { id: "l1", name: "Home Lead", role: "lead" },
        ],
    ),
    listLeads: jest.fn(async () => [{ id: "l1", name: "Home Lead" }]),
    listDashTeam: jest.fn(async () => [
      { id: "t1", role: "planner" },
      { id: "t2", role: "builder" },
    ]),
    save: jest.fn(async (d) => d),
    spendingSummary: jest.fn(async () => ({
      overall: { usd: 0.3, budget: null },
      bots: [],
    })),
    setBudget: jest.fn(async () => ({})),
    onListChanged: () => "1",
    removeListener: () => true,
  };
  window.mainApi = {
    bots: botsApi,
    llm: {
      listModels: jest.fn(async () => ({ models: MODELS })),
      checkCliAvailable: jest.fn(async () => ({ available: true })),
      ...llm,
    },
  };
  const changeSettings = jest.fn();
  render(
    <AppContext.Provider
      value={{ providers, settings: {}, changeSettings, credentials: {} }}
    >
      <AiAssistantSection />
    </AppContext.Provider>,
  );
  return { changeSettings };
}

afterEach(() => {
  delete window.mainApi;
});

const KEY = {
  "Anthropic (AI Assistant)": { type: "anthropic", credentials: {} },
};

test("today: no bot picks a model, so they run on Opus — flagged plainly", async () => {
  setup();
  await waitFor(() =>
    expect(screen.getByTestId("ai-bot-models-summary")).toHaveTextContent(
      "All 2 bots use the default (Opus 5.5). That's the most expensive model.",
    ),
  );
  const bots = screen.getByTestId("ai-job-bots");
  expect(bots).toHaveTextContent("Most expensive");
  expect(bots).toHaveTextContent("Included in plan");
  // The lead isn't counted as a bot.
  expect(bots).toHaveTextContent("2 bots use it");
});

test("a job's default model and style save to Settings › AI", async () => {
  setup();
  const select = await screen.findByLabelText("Bots model");
  fireEvent.change(select, { target: { value: "claude-haiku-5-5" } });
  await waitFor(() =>
    expect(botsApi.setSettings).toHaveBeenCalledWith({
      ai: { defaults: { bots: { model: "claude-haiku-5-5" } } },
    }),
  );
  fireEvent.change(screen.getByLabelText("Create · Planner style"), {
    target: { value: "thorough" },
  });
  await waitFor(() =>
    expect(botsApi.setSettings).toHaveBeenCalledWith({
      ai: { defaults: { planner: { style: "thorough" } } },
    }),
  );
});

test("the API key can't be chosen without a key", async () => {
  setup();
  const radio = await screen.findByDisplayValue("api");
  fireEvent.click(radio);
  expect(screen.queryByTestId("ai-switch")).toBeNull();
  expect(screen.getByLabelText("Anthropic API key")).toBeInTheDocument();
});

test("choosing the API key asks first and offers cheaper defaults", async () => {
  const { changeSettings } = setup({ providers: KEY });
  const radio = await screen.findByDisplayValue("api");
  fireEvent.click(radio);
  const dialog = await screen.findByTestId("ai-switch");
  expect(dialog).toHaveTextContent("2 bots");
  expect(dialog).toHaveTextContent("1 dashboard lead");
  expect(dialog).toHaveTextContent(
    "Some jobs run on Opus 5.5 by default, the most expensive model",
  );
  expect(
    screen.getByLabelText(
      "Use cheaper defaults where you haven't chosen: Haiku for bots and leads, Sonnet for Create",
    ),
  ).toBeChecked();
  fireEvent.click(screen.getByText("Use my API key"));
  await waitFor(() =>
    expect(botsApi.setSettings).toHaveBeenCalledWith({
      ai: {
        backend: "api",
        defaults: {
          bots: { model: "claude-haiku-5-5", style: "brief" },
          leads: { model: "claude-haiku-5-5", style: "brief" },
          planner: { model: "claude-sonnet-5-5", style: "thorough" },
          builder: { model: "claude-sonnet-5-5", style: "normal" },
          checker: { model: "claude-sonnet-5-5", style: "normal" },
          scout: { model: "claude-haiku-5-5", style: "normal" },
          dashLead: { model: "claude-haiku-5-5", style: "normal" },
        },
      },
    }),
  );
  // The old app setting follows.
  expect(changeSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      aiAssistant: expect.objectContaining({ preferredBackend: "anthropic" }),
    }),
  );
});

test("unticking cheaper defaults switches without changing them", async () => {
  setup({ providers: KEY });
  fireEvent.click(await screen.findByDisplayValue("api"));
  await screen.findByTestId("ai-switch");
  fireEvent.click(
    screen.getByLabelText(
      "Use cheaper defaults where you haven't chosen: Haiku for bots and leads, Sonnet for Create",
    ),
  );
  fireEvent.click(screen.getByText("Use my API key"));
  await waitFor(() =>
    expect(botsApi.setSettings).toHaveBeenCalledWith({
      ai: { backend: "api" },
    }),
  );
});

test("on the API key: costs per run and the limits", async () => {
  setup({
    providers: KEY,
    ai: resolved({
      backend: "api",
      defaults: {
        ...resolved().defaults,
        bots: { model: "claude-haiku-5-5", style: "brief" },
      },
    }),
  });
  const row = await screen.findByTestId("ai-job-bots");
  expect(row).toHaveTextContent("≈ $0.0011 a run");
  expect(row).not.toHaveTextContent("Most expensive");
  expect(screen.getByLabelText("Steps per run · bots and leads")).toHaveValue(
    "25",
  );
  fireEvent.change(screen.getByLabelText("Time per run (minutes)"), {
    target: { value: "10" },
  });
  const timeRow = screen
    .getByLabelText("Time per run (minutes)")
    .closest("div").parentElement;
  fireEvent.click(timeRow.querySelector("button"));
  await waitFor(() =>
    expect(botsApi.setSettings).toHaveBeenCalledWith({
      ai: { limits: { minutes: 10 } },
    }),
  );
});

test("the default monthly limit per bot saves to Settings › AI", async () => {
  setup({ providers: KEY });
  const field = await screen.findByTestId("ai-limit-per-bot");
  fireEvent.change(field.querySelector("input"), { target: { value: "10" } });
  fireEvent.click(field.querySelector("button"));
  await waitFor(() =>
    expect(botsApi.setSettings).toHaveBeenCalledWith({
      ai: { limits: { perBot: 10 } },
    }),
  );
});

test("Review all bots opens Bot models", async () => {
  setup();
  fireEvent.click(await screen.findByText("Review all 2 bots"));
  expect(await screen.findByTestId("bot-models")).toBeInTheDocument();
});

test("cheaper defaults keep what the user already chose", async () => {
  setup({
    providers: KEY,
    ai: resolved({
      defaults: {
        ...resolved().defaults,
        bots: { model: "claude-sonnet-5-5", style: null },
      },
    }),
  });
  fireEvent.click(await screen.findByDisplayValue("api"));
  await screen.findByTestId("ai-switch");
  fireEvent.click(screen.getByText("Use my API key"));
  await waitFor(() => expect(botsApi.setSettings).toHaveBeenCalled());
  const patch = botsApi.setSettings.mock.calls[0][0].ai;
  // Its model stays; only the style it hadn't set is filled in.
  expect(patch.defaults.bots).toEqual({ style: "brief" });
  expect(patch.defaults.leads).toEqual({
    model: "claude-haiku-5-5",
    style: "brief",
  });
});

test("a saved key says so, by its last characters, and Replace key opens the field", async () => {
  setup({
    providers: {
      anthropic: {
        type: "anthropic",
        credentials: { apiKey: "sk-ant-api03-abcdefghij3f2a" },
      },
    },
  });
  const field = await screen.findByTestId("ai-api-key");
  expect(field).toHaveTextContent("Key saved");
  expect(field).toHaveTextContent("sk-ant-…3f2a");
  expect(field).not.toHaveTextContent("abcdefghij");
  expect(screen.queryByLabelText("New key")).toBeNull();
  fireEvent.click(screen.getByText("Replace key"));
  expect(screen.getByLabelText("New key")).toBeInTheDocument();
  expect(field).toHaveTextContent("Replaces the saved key (sk-ant-…3f2a)");
  fireEvent.click(screen.getByText("Cancel"));
  expect(screen.queryByLabelText("New key")).toBeNull();
});

test("no key: says none is saved yet", async () => {
  setup();
  expect(await screen.findByTestId("ai-api-key")).toHaveTextContent(
    "No key saved yet.",
  );
});

test("maskedKey never gives the key", () => {
  expect(maskedKey("sk-ant-api03-abcdefghij3f2a")).toBe("sk-ant-…3f2a");
  expect(maskedKey("short")).toBeNull();
  expect(maskedKey(undefined)).toBeNull();
});

describe("models stay current", () => {
  const FAMILY_MODELS = [
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
      value: "claude-opus-4-8",
      label: "Claude Opus 4.8",
      family: "opus",
      status: "older",
      tier: "deep",
    },
  ];
  const checkedAt = new Date(2026, 10, 15, 9, 12).getTime();
  const llm = (status, over = {}) => ({
    listModels: jest.fn(async () => ({ models: FAMILY_MODELS })),
    modelListStatus: jest.fn(async () => status),
    checkModelList: jest.fn(async () => status),
    modelListSeen: jest.fn(async () => ({ ...status, added: [] })),
    onModelListChanged: () => "m1",
    removeStreamListener: () => true,
    ...over,
  });

  test("says when the list was checked, and Check now asks again", async () => {
    const api = llm({ source: "dash", checkedAt, error: null, added: [] });
    setup({ llm: api });
    await waitFor(() =>
      expect(screen.getByTestId("ai-model-list-status")).toHaveTextContent(
        /Model list up to date · checked/,
      ),
    );
    fireEvent.click(screen.getByText("Check now"));
    await waitFor(() => expect(api.checkModelList).toHaveBeenCalled());
  });

  test("a failed check says so and keeps the last list", async () => {
    setup({
      llm: llm({ source: "dash", checkedAt, error: "offline", added: [] }),
    });
    await waitFor(() =>
      expect(screen.getByTestId("ai-model-list-status")).toHaveTextContent(
        /Last checked .* · couldn't reach the list/,
      ),
    );
  });

  test("a default can follow the newest of a family", async () => {
    const ai = resolved();
    ai.defaults.bots = { model: "latest:haiku", style: "brief" };
    setup({
      ai,
      llm: llm({ source: "dash", checkedAt, error: null, added: [] }),
    });
    await waitFor(() =>
      expect(screen.getByTestId("ai-bot-models-summary")).toHaveTextContent(
        "All 2 bots use the default (Latest Haiku, now Haiku 5.5).",
      ),
    );
    const select = screen.getByLabelText("Create · Builder model");
    const labels = [...select.querySelectorAll("option")].map(
      (o) => o.textContent,
    );
    expect(labels).toEqual(
      expect.arrayContaining(["Latest Opus", "Latest Fable", "Opus 4.8"]),
    );
    fireEvent.change(select, { target: { value: "latest:opus" } });
    await waitFor(() =>
      expect(botsApi.setSettings).toHaveBeenCalledWith({
        ai: { defaults: { builder: { model: "latest:opus" } } },
      }),
    );
  });

  test("a retired model still saved: where, what it runs on, and Move all", async () => {
    const OLD = "claude-sonnet-4-20250514";
    const usage = {
      retired: [
        {
          model: OLD,
          to: "latest:sonnet",
          count: 12,
          kinds: { default: 0, bot: 0, teamPick: 0, widget: 12 },
          dashboards: [
            { workspaceId: 1, name: "Kitchen Sink", count: 2 },
            { workspaceId: 2, name: "Kitchen Sink", count: 2 },
            { workspaceId: 3, name: "Kitchen Sink", count: 2 },
            { workspaceId: 4, name: "Kitchen Sink 2", count: 2 },
            { workspaceId: 5, name: "Workshop Command Center", count: 2 },
            { workspaceId: 6, name: "Kitchen Sinkq", count: 1 },
            { workspaceId: 7, name: "Chat test", count: 1 },
          ],
          bots: [],
          defaultJobs: [],
        },
      ],
      widgetsFollowing: {},
    };
    let moved = false;
    const api = llm(
      { source: "dash", checkedAt, error: null, added: [] },
      {
        modelUsage: jest.fn(async () =>
          moved ? { retired: [], widgetsFollowing: {} } : usage,
        ),
        moveRetiredModel: jest.fn(async () => {
          moved = true;
          return { moved: 12, to: "latest:sonnet", dashboards: 7, failed: 0 };
        }),
      },
    );
    setup({ llm: api });
    const notice = await screen.findByTestId("ai-retired-model");
    expect(notice).toHaveTextContent(
      "12 widgets are set to Claude Sonnet 4, which Anthropic retired",
    );
    expect(notice).toHaveTextContent(
      "They've been running on Sonnet 5.5 instead.",
    );
    expect(notice).toHaveTextContent("Kitchen Sink (3 dashboards)6 widgets");
    expect(notice).toHaveTextContent("Chat test1 widget");
    fireEvent.click(screen.getByText("Move all 12 to Latest Sonnet"));
    await waitFor(() =>
      expect(api.moveRetiredModel).toHaveBeenCalledWith(OLD, "latest:sonnet", {
        forAll: true,
      }),
    );
    expect(await screen.findByTestId("ai-model-moved")).toHaveTextContent(
      "Moved 12 widgets on 7 dashboards from Claude Sonnet 4 to Latest Sonnet (now Sonnet 5.5).",
    );
    await waitFor(() =>
      expect(screen.queryByTestId("ai-retired-model")).toBeNull(),
    );
  });

  test("move them to Latest, or to the exact version", async () => {
    const OLD = "claude-sonnet-4-20250514";
    const api = llm(
      { source: "dash", checkedAt, error: null, added: [] },
      {
        modelUsage: jest.fn(async () => ({
          retired: [
            {
              model: OLD,
              to: "latest:sonnet",
              count: 10,
              kinds: { default: 0, bot: 0, teamPick: 0, widget: 10 },
              exactWidgets: 10,
              dashboards: [
                {
                  workspaceId: 1,
                  name: "Kitchen Sink",
                  count: 10,
                  otherProfile: true,
                },
              ],
              bots: [],
              defaultJobs: [],
            },
          ],
          widgetsFollowing: {},
        })),
        moveRetiredModel: jest.fn(async () => ({
          moved: 10,
          to: "claude-sonnet-5-5",
          dashboards: 1,
          failed: 0,
          exact: 0,
        })),
      },
    );
    setup({ llm: api });
    const notice = await screen.findByTestId("ai-retired-model");
    expect(notice).toHaveTextContent("Kitchen Sink · in another profile");
    expect(notice).not.toHaveTextContent("exact versions");
    expect(
      screen.getByText("Move all 10 to Latest Sonnet"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Move all 10 to Sonnet 5.5"));
    await waitFor(() =>
      expect(api.moveRetiredModel).toHaveBeenCalledWith(
        OLD,
        "claude-sonnet-5-5",
        { forAll: true },
      ),
    );
    expect(await screen.findByTestId("ai-model-moved")).toHaveTextContent(
      "Moved 10 widgets on 1 dashboard from Claude Sonnet 4 to Sonnet 5.5.",
    );
  });

  test("Choose another model moves them to the one picked", async () => {
    const OLD = "claude-3-5-haiku-20241022";
    const api = llm(
      { source: "dash", checkedAt, error: null, added: [] },
      {
        modelUsage: jest.fn(async () => ({
          retired: [
            {
              model: OLD,
              to: "latest:haiku",
              count: 1,
              kinds: { default: 0, bot: 1, teamPick: 0, widget: 0 },
              dashboards: [],
              bots: [{ id: "b1", name: "Recipe Bot" }],
              defaultJobs: [],
            },
          ],
          widgetsFollowing: {},
        })),
        moveRetiredModel: jest.fn(async () => ({
          moved: 1,
          to: "latest:sonnet",
          dashboards: 0,
          failed: 0,
        })),
      },
    );
    setup({ llm: api });
    const notice = await screen.findByTestId("ai-retired-model");
    expect(notice).toHaveTextContent(
      "1 bot is set to Claude 3.5 Haiku, which Anthropic retired",
    );
    expect(notice).toHaveTextContent("Recipe Botbot");
    fireEvent.click(screen.getByText("Choose another model"));
    fireEvent.change(screen.getByLabelText("Move them to"), {
      target: { value: "latest:sonnet" },
    });
    fireEvent.click(screen.getByText("Move all 1"));
    await waitFor(() =>
      expect(api.moveRetiredModel).toHaveBeenCalledWith(OLD, "latest:sonnet", {
        forAll: true,
      }),
    );
  });

  const exactDefaults = () => {
    const ai = resolved({ followAsked: false });
    ai.defaults.bots = { model: "claude-haiku-5-5", style: "brief" };
    ai.defaults.planner = { model: "claude-opus-5-5", style: "thorough" };
    ai.defaults.checker = { model: "claude-sonnet-5-5", style: "normal" };
    return ai;
  };

  test("once: exact defaults are offered to follow the newest instead", async () => {
    setup({
      ai: exactDefaults(),
      llm: llm({ source: "dash", checkedAt, error: null, added: [] }),
    });
    const dialog = await screen.findByTestId("ai-follow-newest");
    expect(dialog).toHaveTextContent("Haiku 5.5→Latest Haiku");
    expect(dialog).toHaveTextContent(
      "Nothing changes today: each one is already the newest of its family.",
    );
    // Untick one: it keeps its exact version.
    fireEvent.click(screen.getByLabelText("Create · Checker"));
    fireEvent.click(screen.getByText("Follow the newest (2)"));
    await waitFor(() =>
      expect(botsApi.setSettings).toHaveBeenCalledWith({
        ai: {
          followAsked: true,
          defaults: {
            bots: { model: "latest:haiku" },
            planner: { model: "latest:opus" },
          },
        },
      }),
    );
  });

  test("Keep exact versions only says it was asked", async () => {
    setup({
      ai: exactDefaults(),
      llm: llm({ source: "dash", checkedAt, error: null, added: [] }),
    });
    await screen.findByTestId("ai-follow-newest");
    fireEvent.click(screen.getByText("Keep exact versions"));
    await waitFor(() =>
      expect(botsApi.setSettings).toHaveBeenCalledWith({
        ai: { followAsked: true },
      }),
    );
  });

  test("not asked again once answered", async () => {
    setup({
      ai: { ...exactDefaults(), followAsked: true },
      llm: llm({ source: "dash", checkedAt, error: null, added: [] }),
    });
    await screen.findByTestId("ai-model-list-status");
    expect(screen.queryByTestId("ai-follow-newest")).toBeNull();
  });

  test("a new model: what came out and that nothing changed, until dismissed", async () => {
    const api = llm({
      source: "dash",
      checkedAt,
      error: null,
      added: ["claude-fable-5-2"],
    });
    setup({ llm: api });
    const notice = await screen.findByTestId("ai-new-model");
    expect(notice).toHaveTextContent("Claude Fable 5.2 is out");
    expect(notice).toHaveTextContent(
      "None of your defaults, bots or widgets use Fable, so nothing changed.",
    );
    expect(screen.getByTestId("ai-model-list-status")).toHaveTextContent(
      /Model list updated/,
    );
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() => expect(api.modelListSeen).toHaveBeenCalled());
  });
});

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AiAssistantSection } from "./AiAssistantSection";
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

function setup({ ai = resolved(), providers = {}, bots } = {}) {
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
  expect(dialog).toHaveTextContent("1 dashboard leads");
  expect(dialog).toHaveTextContent(
    "Some jobs run on Opus 5.5 by default, the most expensive model",
  );
  expect(
    screen.getByLabelText(
      "Use cheaper defaults: Haiku for bots and leads, Sonnet for Create",
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
          checker: { model: "claude-sonnet-5-5", style: "brief" },
          scout: { model: "claude-haiku-5-5", style: "brief" },
          dashLead: { model: "claude-haiku-5-5", style: "brief" },
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
      "Use cheaper defaults: Haiku for bots and leads, Sonnet for Create",
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
  expect(row).toHaveTextContent("≈ $0.0007 a run");
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

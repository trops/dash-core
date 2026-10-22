/**
 * DashTeamPanel — a Dash team role on the Bots page (create-entry CRE-011).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DashTeamPanel } from "./DashTeamPanel";

const scout = {
  id: "b_scout",
  name: "Scout",
  system: "dash-team",
  role: "scout",
  summary: "Finds what you already have — widgets, providers, bots.",
  tier: "fast",
  providerId: "claude-code",
  model: null,
  runsOn: "claude-haiku-4-5",
  recommendedModel: "claude-haiku-4-5",
  paused: false,
};

let botsApi;
beforeEach(() => {
  botsApi = {
    setSettings: jest.fn().mockResolvedValue({}),
    pauseBot: jest.fn().mockResolvedValue({}),
    resumeBot: jest.fn().mockResolvedValue({}),
  };
  window.mainApi = {
    bots: botsApi,
    llm: {
      listModels: jest.fn().mockResolvedValue({
        models: [
          { value: "claude-opus-4-8", label: "Opus" },
          { value: "claude-sonnet-4-6", label: "Sonnet" },
          { value: "claude-haiku-4-5", label: "Haiku" },
        ],
      }),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

function setup(bot = scout, over = {}) {
  const onChanged = jest.fn().mockResolvedValue();
  const onEdit = jest.fn();
  render(
    <DashTeamPanel
      bot={bot}
      status="Idle"
      lastRun={null}
      onChanged={onChanged}
      onEdit={onEdit}
      {...over}
    />,
  );
  return { onChanged, onEdit };
}

test("shows the role's job, its recommended model first, and no Delete", async () => {
  setup();
  expect(screen.getByText(scout.summary)).toBeInTheDocument();
  expect(screen.getByText("Dash team")).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByLabelText("Model").options.length).toBe(3),
  );
  const labels = Array.from(screen.getByLabelText("Model").options).map(
    (o) => o.textContent,
  );
  expect(labels[0]).toBe("Recommended: Haiku");
  expect(screen.queryByText("Delete")).toBeNull();
});

test("Dash team is a badge, Model is labelled once, Last run is a titled group", async () => {
  setup();
  expect(
    screen.getByText("Dash team").closest("[data-testid='status-badge']"),
  ).not.toBeNull();
  await waitFor(() =>
    expect(screen.getByLabelText("Model").options.length).toBe(3),
  );
  // Only the picker's own label — no separate "Model" section label.
  expect(screen.getAllByText("Model")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Last run" })).toBeInTheDocument();
});

test("picking a model saves it for this role on this provider", async () => {
  const { onChanged } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("Model").options.length).toBe(3),
  );
  fireEvent.change(screen.getByLabelText("Model"), {
    target: { value: "claude-sonnet-4-6" },
  });
  await waitFor(() =>
    expect(botsApi.setSettings).toHaveBeenCalledWith({
      dashTeam: {
        models: { "claude-code": { scout: "claude-sonnet-4-6" } },
      },
    }),
  );
  expect(onChanged).toHaveBeenCalled();
});

test("picking the recommended model clears the override", async () => {
  setup({ ...scout, runsOn: "claude-sonnet-4-6" });
  await waitFor(() =>
    expect(screen.getByLabelText("Model").options.length).toBe(3),
  );
  fireEvent.change(screen.getByLabelText("Model"), {
    target: { value: "claude-haiku-4-5" },
  });
  await waitFor(() =>
    expect(botsApi.setSettings).toHaveBeenCalledWith({
      dashTeam: { models: { "claude-code": { scout: null } } },
    }),
  );
});

test("Pause and Resume", async () => {
  setup();
  fireEvent.click(screen.getByText("Pause"));
  await waitFor(() => expect(botsApi.pauseBot).toHaveBeenCalledWith("b_scout"));
});

test("a paused role offers Turn on", async () => {
  setup({ ...scout, paused: true });
  fireEvent.click(screen.getByText("Turn on"));
  await waitFor(() =>
    expect(botsApi.resumeBot).toHaveBeenCalledWith("b_scout"),
  );
});

test("a model set on the bot itself is shown, not the picker", () => {
  setup({ ...scout, model: "claude-opus-4-8", runsOn: "claude-opus-4-8" });
  expect(screen.queryByLabelText("Model")).toBeNull();
  expect(
    screen.getByText("Opus — set on this bot (change it in Edit)"),
  ).toBeInTheDocument();
});

test("its last run shows model, tokens and cost", () => {
  setup(scout, {
    lastRun: {
      status: "completed",
      model: "claude-haiku-4-5",
      usage: { inputTokens: 1200, outputTokens: 100 },
      cost: { usd: 0, includedInPlan: true, estimated: false },
      output: "Found 2 widgets.",
    },
  });
  expect(
    screen.getByText("Haiku · 1.3k tokens · included in your plan"),
  ).toBeInTheDocument();
});

test("its last run's answer hides the <matches> / <plan> blocks (QA 2026-10-22)", () => {
  setup(scout, {
    lastRun: {
      status: "completed",
      output:
        'Found 1 widget.\n<matches>[{"source":"Registry","name":"Clock"}]</matches>',
    },
  });
  expect(screen.getByText("Found 1 widget.")).toBeInTheDocument();
  expect(screen.queryByText(/<matches>/)).toBeNull();
});

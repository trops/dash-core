import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BotModelsList } from "./BotModelsList";

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

const defaults = (over = {}) => {
  const d = {};
  for (const job of [
    "bots",
    "leads",
    "planner",
    "builder",
    "checker",
    "scout",
    "dashLead",
  ]) {
    d[job] = { model: null, style: null };
  }
  return { ...d, ...over };
};

const BOTS = [
  { id: "b1", name: "Agenda" },
  { id: "b2", name: "Recipe Bot", schedules: [{ cron: "0 8 * * 0" }] },
  { id: "b3", name: "Inbox", subscriptions: [{ event: "x" }] },
  { id: "b4", name: "Writer", model: "claude-sonnet-5-5" },
  { id: "b5", name: "Grok Bot", provider: "xai", model: "grok-4" },
];

function setup({ ai } = {}) {
  const saveBot = jest.fn(async (d) => d);
  const onChanged = jest.fn(async () => {});
  render(
    <BotModelsList
      ai={
        ai || {
          backend: "api",
          defaults: defaults(),
          limits: { perBot: 10 },
        }
      }
      models={MODELS}
      bots={BOTS}
      leads={[{ id: "l1" }, { id: "l2", model: "claude-opus-5-5" }]}
      team={[{ id: "t1" }, { id: "t2" }]}
      spending={{ bots: [{ id: "b1", usd: 0.28, budget: null }] }}
      saveBot={saveBot}
      onChanged={onChanged}
      onBack={jest.fn()}
    />,
  );
  return { saveBot, onChanged };
}

test("every bot with what starts it, its model, a run's cost and this month", () => {
  setup();
  const agenda = screen.getByTestId("bot-models-row-b1");
  expect(agenda).toHaveTextContent("When asked");
  // No model of its own: the default — Opus, the most expensive.
  expect(screen.getByLabelText("Agenda model")).toHaveValue("");
  expect(agenda).toHaveTextContent("Most expensive");
  expect(agenda).toHaveTextContent("$0.28 of $10.00");
  expect(screen.getByTestId("bot-models-row-b2")).toHaveTextContent(
    "Every Sunday at 8:00 AM",
  );
  expect(screen.getByTestId("bot-models-row-b3")).toHaveTextContent(
    "When an event arrives",
  );
  const writer = screen.getByTestId("bot-models-row-b4");
  expect(screen.getByLabelText("Writer model")).toHaveValue(
    "claude-sonnet-5-5",
  );
  expect(writer).not.toHaveTextContent("Most expensive");
  expect(screen.getByTestId("bot-models-leads")).toHaveTextContent(
    "Dashboard leads · 2",
  );
  expect(screen.getByTestId("bot-models-leads")).toHaveTextContent(
    "1 use the default · Haiku 5.5 · 1 picks its own",
  );
  expect(screen.getByTestId("bot-models-create")).toHaveTextContent(
    "Create (Dash team) · 2 roles",
  );
});

test("filters: default model / own model", () => {
  setup();
  fireEvent.click(screen.getByText("Own model · 2"));
  expect(screen.queryByTestId("bot-models-row-b1")).toBeNull();
  expect(screen.getByTestId("bot-models-row-b4")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Default model · 3"));
  expect(screen.getByTestId("bot-models-row-b1")).toBeInTheDocument();
  expect(screen.queryByTestId("bot-models-row-b4")).toBeNull();
});

test("one bot's model changes from its row", async () => {
  const { saveBot, onChanged } = setup();
  fireEvent.change(screen.getByLabelText("Agenda model"), {
    target: { value: "claude-haiku-5-5" },
  });
  await waitFor(() =>
    expect(saveBot).toHaveBeenCalledWith({
      id: "b1",
      model: "claude-haiku-5-5",
    }),
  );
  expect(onChanged).toHaveBeenCalled();
});

test("tick several and set them all at once; only those change", async () => {
  const { saveBot } = setup();
  fireEvent.click(screen.getByLabelText("Agenda"));
  fireEvent.click(screen.getByLabelText("Inbox"));
  const bulk = screen.getByTestId("bot-models-bulk");
  expect(bulk).toHaveTextContent("2 bots selected");
  fireEvent.change(screen.getByLabelText("Model for the selected bots"), {
    target: { value: "claude-sonnet-5-5" },
  });
  fireEvent.click(screen.getByText("Apply to 2"));
  await waitFor(() => expect(saveBot).toHaveBeenCalledTimes(2));
  expect(saveBot).toHaveBeenCalledWith({
    id: "b1",
    model: "claude-sonnet-5-5",
  });
  expect(saveBot).toHaveBeenCalledWith({
    id: "b3",
    model: "claude-sonnet-5-5",
  });
  await waitFor(() =>
    expect(screen.queryByTestId("bot-models-bulk")).toBeNull(),
  );
});

test("Select all ticks every Claude bot; Default puts them back on the default", async () => {
  const { saveBot } = setup();
  fireEvent.click(screen.getByLabelText("Select all"));
  expect(screen.getByTestId("bot-models-bulk")).toHaveTextContent(
    "4 bots selected",
  );
  fireEvent.click(screen.getByText("Apply to 4"));
  await waitFor(() => expect(saveBot).toHaveBeenCalledTimes(4));
  expect(saveBot).toHaveBeenCalledWith({ id: "b4", model: null });
});

test("with a cheap default, nothing is flagged", () => {
  setup({
    ai: {
      backend: "api",
      defaults: defaults({ bots: { model: "claude-haiku-5-5" } }),
      limits: { perBot: null },
    },
  });
  expect(screen.getByTestId("bot-models-row-b1")).not.toHaveTextContent(
    "Most expensive",
  );
  // No limit: just what it spent.
  expect(screen.getByTestId("bot-models-row-b1")).toHaveTextContent("$0.28");
  expect(screen.getByTestId("bot-models-row-b1")).not.toHaveTextContent(" of ");
});

test("a bot on another AI provider shows it and isn't given a Claude model", () => {
  setup();
  const row = screen.getByTestId("bot-models-row-b5");
  expect(row).toHaveTextContent("xAI · grok-4 — set in its settings");
  expect(screen.queryByLabelText("Grok Bot model")).toBeNull();
  expect(screen.queryByLabelText("Grok Bot")).toBeNull();
  expect(row).not.toHaveTextContent("Most expensive");
});

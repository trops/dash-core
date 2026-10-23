/**
 * Create's start screen lists plans you didn't finish (QA 2026-10-22):
 * saved but never built, and builds that stopped part-way. Finished work
 * isn't listed. Continue reopens one; Forget asks, then forgets it.
 */
import React from "react";
import fs from "fs";
import path from "path";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  UnfinishedPlans,
  unfinishedPlans,
  UNFINISHED_LIMIT,
} from "./UnfinishedPlans";

const NOW = Date.now();
const PLANS = [
  { id: "p_draft", title: "Sales board", status: "draft", updatedAt: NOW - 5 },
  { id: "p_stop", title: "Inbox", status: "stopped", updatedAt: NOW - 1 },
  {
    id: "p_int",
    title: "Weather",
    status: "interrupted",
    updatedAt: NOW - 3,
  },
  { id: "p_built", title: "Done one", status: "built", updatedAt: NOW },
  { id: "p_prob", title: "Half", status: "problems", updatedAt: NOW },
  { id: "p_run", title: "Running", status: "building", updatedAt: NOW },
  { id: "q_1", kind: "question", title: "What ran?", updatedAt: NOW },
];

function api(plans = PLANS) {
  const bots = {
    listCreateRecent: jest.fn().mockResolvedValue(plans),
    onCreateRecent: jest.fn(() => 7),
    removeListener: jest.fn(),
    removeCreateRecent: jest.fn().mockResolvedValue({}),
  };
  window.mainApi = { bots };
  return bots;
}

afterEach(() => {
  delete window.mainApi;
});

test("only unfinished plans — never built, building or waiting, stopped part-way, or built with problems — newest first", () => {
  expect(unfinishedPlans(PLANS).map((r) => [r.id, r.started])).toEqual([
    ["p_prob", true],
    ["p_run", true],
    ["p_stop", true],
    ["p_int", true],
    ["p_draft", false],
  ]);
  expect(
    unfinishedPlans([
      { id: "w", status: "waiting", waitingFor: ["slack"], updatedAt: 1 },
    ]).map((r) => r.id),
  ).toEqual(["w"]);
  expect(unfinishedPlans([{ id: "x", updatedAt: 1 }])[0].status).toBe(
    "Draft plan",
  );
});

test("a widget plan is unfinished until its widget is added; it reopens as a widget plan", () => {
  const rows = unfinishedPlans([
    { id: "w1", widget: true, status: "built", updatedAt: 3 },
    {
      id: "w2",
      widget: true,
      widgetAdded: true,
      status: "built",
      updatedAt: 2,
    },
    { id: "w3", widget: true, status: "draft", updatedAt: 1 },
    { id: "w4", widget: true, status: "ready", updatedAt: 0 },
    { id: "d1", status: "ready", updatedAt: -1 },
  ]);
  expect(rows.map((r) => [r.id, r.status, r.widget])).toEqual([
    ["w1", "Ready to add", true],
    ["w3", "Draft plan", true],
    ["w4", "Ready to add", true],
    ["d1", "Ready for you to look at", false],
  ]);
});

test("at most a few", () => {
  const many = Array.from({ length: UNFINISHED_LIMIT + 2 }, (_, i) => ({
    id: `p${i}`,
    status: "draft",
    updatedAt: i,
  }));
  expect(unfinishedPlans(many)).toHaveLength(UNFINISHED_LIMIT);
});

test("nothing unfinished: nothing shows", async () => {
  const bots = api(
    PLANS.filter((p) => p.status === "built" || p.kind === "question"),
  );
  const { container } = render(<UnfinishedPlans onContinue={jest.fn()} />);
  await waitFor(() => expect(bots.listCreateRecent).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("Continue reopens a never-built plan and a stopped build alike", async () => {
  api();
  const onContinue = jest.fn();
  render(<UnfinishedPlans onContinue={onContinue} />);
  const list = await screen.findByTestId("create-unfinished");
  expect(list).toHaveTextContent("Unfinished");
  expect(list).toHaveTextContent("Stopped");
  expect(list).not.toHaveTextContent("Done one");
  fireEvent.click(screen.getByRole("button", { name: "Continue Sales board" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue Inbox" }));
  expect(onContinue.mock.calls.map((c) => c[0].id)).toEqual([
    "p_draft",
    "p_stop",
  ]);
});

test("Discard (never built) asks first, then forgets the plan — the plan menu's words", async () => {
  const bots = api();
  render(<UnfinishedPlans onContinue={jest.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard Sales board" }),
  );
  expect(bots.removeCreateRecent).not.toHaveBeenCalled();
  expect(screen.getByText(/Nothing has been built/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Discard plan" }));
  await waitFor(() =>
    expect(bots.removeCreateRecent).toHaveBeenCalledWith("p_draft"),
  );
});

test("Create's start screen shows it (not for a cell) and Continue opens the plan step", () => {
  const src = fs.readFileSync(path.join(__dirname, "CreateModal.js"), "utf8");
  expect(src).toMatch(
    /\{!cell \? \(\s*<UnfinishedPlans\s+onContinue=\{\(row\) =>\s*setPlanStep\(\{\s*prompt: "",\s*recentId: row\.id,[\s\S]{0,80}\.\.\.\(row\.widget \? \{ widget: true \} : \{\}\),/,
  );
});

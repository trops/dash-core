/**
 * CreateDockPanel and Fold (create-entry PRD CRE-007 AC1, phase 4e-2): a
 * plan conversation folds from the Create modal into the right-hand dock,
 * carries on there, and expands back.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { CreateDockPanel, foldCreate } from "./CreateDockPanel";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));
// The question thread itself is AskStep's (AskStep.test.js); here only that
// a question opens in the dock.
jest.mock("./AskStep", () => ({
  AskStep: ({ question }) => <div data-testid="ask-step">{question}</div>,
}));

const PLAN = {
  summary: "Ask and greet",
  pieces: [
    { kind: "widget", name: "Ask", source: "new" },
    { kind: "layout", name: "Ask Test", source: "new" },
  ],
};

beforeEach(() => {
  window.mainApi = {
    bots: {
      listCreateRecent: jest.fn().mockResolvedValue([
        {
          id: "plan_1",
          title: "Ask Test",
          status: "draft",
          updatedAt: new Date().toISOString(),
        },
      ]),
      onCreateRecent: jest.fn(() => 4),
      removeListener: jest.fn(),
      listDashTeam: jest.fn().mockResolvedValue([]),
      onStream: jest.fn(() => 1),
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_1" }),
      getCreateRecent: jest.fn().mockResolvedValue({
        id: "plan_1",
        prompt: "A greeter",
        conversation: {
          messages: [
            { who: "you", text: "A greeter" },
            { who: "planner", text: "Here's the plan." },
          ],
          plan: PLAN,
        },
        build: null,
      }),
    },
    drafts: {
      list: jest
        .fn()
        .mockResolvedValue([{ id: "d1", name: "Clock", updatedAt: 1 }]),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

test("nothing folded: Recent, newest first; a plan opens full size, a draft in the Widget Builder", async () => {
  const onCollapse = jest.fn();
  render(<CreateDockPanel onCollapse={onCollapse} />);
  const plan = await screen.findByText("Ask Test");
  expect(screen.getByText("Clock")).toBeInTheDocument();
  const onBuilder = jest.fn();
  window.addEventListener("dash:open-widget-builder", onBuilder);
  fireEvent.click(screen.getByText("Clock"));
  window.removeEventListener("dash:open-widget-builder", onBuilder);
  expect(onBuilder.mock.calls[0][0].detail).toEqual({ resumeDraftId: "d1" });
  // A plan has a lot to review: it opens in Create full size, not here.
  const onOpen = jest.fn();
  window.addEventListener("dash:open-create", onOpen);
  fireEvent.click(plan);
  window.removeEventListener("dash:open-create", onOpen);
  expect(onOpen.mock.calls[0][0].detail).toEqual({
    type: "dashboard",
    recentId: "plan_1",
  });
  expect(onCollapse).toHaveBeenCalled();
  expect(screen.queryByTestId("plan-card")).toBeNull();
});

test("a question from Recent still opens here", async () => {
  window.mainApi.bots.listCreateRecent.mockResolvedValue([
    {
      id: "q_1",
      kind: "question",
      title: "What ran today?",
      status: "answered",
      updatedAt: new Date().toISOString(),
    },
  ]);
  const onCollapse = jest.fn();
  render(<CreateDockPanel onCollapse={onCollapse} />);
  const onOpen = jest.fn();
  window.addEventListener("dash:open-create", onOpen);
  fireEvent.click(await screen.findByText("What ran today?"));
  window.removeEventListener("dash:open-create", onOpen);
  expect(await screen.findByTestId("ask-step")).toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
  expect(onCollapse).not.toHaveBeenCalled();
});

test("a fold lands here as the conversation; Expand reopens it in Create", async () => {
  const onCollapse = jest.fn();
  render(<CreateDockPanel onCollapse={onCollapse} />);
  act(() => foldCreate({ recentId: "plan_1", title: "Plan a dashboard" }));
  expect(await screen.findByText("Here's the plan.")).toBeInTheDocument();
  expect(screen.getByTestId("plan-card")).toBeInTheDocument();
  const onOpen = jest.fn();
  window.addEventListener("dash:open-create", onOpen);
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  window.removeEventListener("dash:open-create", onOpen);
  expect(onOpen.mock.calls[0][0].detail).toEqual({
    type: "dashboard",
    recentId: "plan_1",
  });
  expect(onCollapse).toHaveBeenCalled();
});

test("Back to Recent; collapsed renders nothing but still hears a fold", async () => {
  const { rerender } = render(<CreateDockPanel collapsed />);
  expect(screen.queryByTestId("create-dock")).toBeNull();
  act(() => foldCreate({ recentId: "plan_1", title: "Plan a dashboard" }));
  rerender(<CreateDockPanel />);
  expect(await screen.findByText("Here's the plan.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back to Recent" }));
  await waitFor(() =>
    expect(screen.getByTestId("create-dock-recent")).toBeInTheDocument(),
  );
});

test("Recent in two sections; Make something new opens Create full size (fix/recent-sections)", async () => {
  render(<CreateDockPanel />);
  const conv = await screen.findByTestId("recent-conversations");
  expect(conv).toHaveTextContent("Questions & plans");
  expect(conv).toHaveTextContent("Ask Test");
  const dr = screen.getByTestId("recent-drafts");
  expect(dr).toHaveTextContent("Unfinished widgets");
  expect(dr).toHaveTextContent("Clock");
  expect(dr).toHaveTextContent("Continue in Widget Builder");
  const onOpen = jest.fn();
  window.addEventListener("dash:open-create", onOpen);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Make something new — opens Create full size",
    }),
  );
  window.removeEventListener("dash:open-create", onOpen);
  expect(onOpen.mock.calls[0][0].detail).toEqual({ type: "dashboard" });
});

// Screen audit (October 2026), screen 1: the dock's Create panel follows the
// design guide's Screen layout rules.

test("the Ask box is pinned under Recent, like every chat (guide rule 16)", async () => {
  render(<CreateDockPanel />);
  await screen.findByText("Ask Test");
  const recent = screen.getByTestId("create-dock-recent");
  const box = screen.getByRole("textbox", {
    name: "Ask about your dashboards and bots",
  });
  expect(recent.contains(box)).toBe(false);
  expect(
    recent.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
});

test("asking opens the question here, titled by the question", async () => {
  render(<CreateDockPanel />);
  await screen.findByText("Ask Test");
  const box = screen.getByRole("textbox", {
    name: "Ask about your dashboards and bots",
  });
  fireEvent.change(box, { target: { value: "How many dashboards?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByTestId("ask-step")).toHaveTextContent(
    "How many dashboards?",
  );
  expect(screen.getByTestId("create-dock-header")).toHaveTextContent(
    "How many dashboards?",
  );
  expect(
    screen.getByRole("button", { name: "Back to Recent" }),
  ).toBeInTheDocument();
});

test("nothing yet: an empty state whose one action is Make something new", async () => {
  window.mainApi.bots.listCreateRecent.mockResolvedValue([]);
  window.mainApi.drafts.list.mockResolvedValue([]);
  render(<CreateDockPanel />);
  const empty = await screen.findByTestId("create-dock-empty");
  expect(empty).toHaveTextContent("Nothing here yet");
  const onOpen = jest.fn();
  window.addEventListener("dash:open-create", onOpen);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Make something new — opens Create full size",
    }),
  );
  window.removeEventListener("dash:open-create", onOpen);
  expect(onOpen.mock.calls[0][0].detail).toEqual({ type: "dashboard" });
  // Still askable from an empty dock.
  expect(
    screen.getByRole("textbox", { name: "Ask about your dashboards and bots" }),
  ).toBeInTheDocument();
});

// 2b: questions and plans can be removed from the dock too — asked first.
test("Recent in the dock: × asks, then removes the plan", async () => {
  window.mainApi.bots.removeCreateRecent = jest.fn().mockResolvedValue({});
  render(<CreateDockPanel />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove Ask Test from Recent" }),
  );
  expect(window.mainApi.bots.removeCreateRecent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() =>
    expect(window.mainApi.bots.removeCreateRecent).toHaveBeenCalledWith(
      "plan_1",
    ),
  );
});

test("an open plan in the dock can be discarded from its … menu", async () => {
  window.mainApi.bots.removeCreateRecent = jest.fn().mockResolvedValue({});
  render(<CreateDockPanel />);
  act(() => foldCreate({ recentId: "plan_1", title: "Plan a dashboard" }));
  await screen.findByText("Here's the plan.");
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Discard plan/ }));
  fireEvent.click(screen.getByRole("button", { name: "Discard plan" }));
  await waitFor(() =>
    expect(window.mainApi.bots.removeCreateRecent).toHaveBeenCalledWith(
      "plan_1",
    ),
  );
  // Back on Recent.
  expect(await screen.findByTestId("create-dock-recent")).toBeInTheDocument();
});

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

test("nothing folded: no Recent list — says how a plan gets here (QA 2026-10-22)", async () => {
  render(<CreateDockPanel />);
  const empty = await screen.findByTestId("create-dock-empty");
  expect(empty).toHaveTextContent("No plan folded here");
  expect(empty).toHaveTextContent(
    "To ask a question, open Dash team in the Bots panel.",
  );
  // Recent plans and drafts aren't listed here any more.
  expect(screen.queryByText("Ask Test")).toBeNull();
  expect(screen.queryByText("Clock")).toBeNull();
  expect(window.mainApi.bots.listCreateRecent).not.toHaveBeenCalled();
});

test("Make something new opens Create full size", async () => {
  render(<CreateDockPanel />);
  const onOpen = jest.fn();
  window.addEventListener("dash:open-create", onOpen);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Make something new — opens Create full size",
    }),
  );
  window.removeEventListener("dash:open-create", onOpen);
  expect(onOpen.mock.calls[0][0].detail).toEqual({ type: "dashboard" });
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

test("collapsed renders nothing but still hears a fold", async () => {
  const { rerender } = render(<CreateDockPanel collapsed />);
  expect(screen.queryByTestId("create-dock")).toBeNull();
  act(() => foldCreate({ recentId: "plan_1", title: "Plan a dashboard" }));
  rerender(<CreateDockPanel />);
  expect(await screen.findByText("Here's the plan.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Back to Recent" })).toBeNull();
});

test("no Ask box — asking moved to the Dash team in the Bots panel (Phase 4a)", async () => {
  render(<CreateDockPanel />);
  await screen.findByTestId("create-dock-empty");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  expect(screen.queryByText(/^To:/)).toBeNull();
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
  expect(await screen.findByTestId("create-dock-empty")).toBeInTheDocument();
});

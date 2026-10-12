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

test("nothing folded: Recent, newest first; a plan opens here, a draft in the Widget Builder", async () => {
  render(<CreateDockPanel />);
  const plan = await screen.findByText("Ask Test");
  expect(screen.getByText("Clock")).toBeInTheDocument();
  const onBuilder = jest.fn();
  window.addEventListener("dash:open-widget-builder", onBuilder);
  fireEvent.click(screen.getByText("Clock"));
  window.removeEventListener("dash:open-widget-builder", onBuilder);
  expect(onBuilder.mock.calls[0][0].detail).toEqual({ resumeDraftId: "d1" });
  fireEvent.click(plan);
  expect(await screen.findByTestId("plan-card")).toBeInTheDocument();
  expect(window.mainApi.bots.getCreateRecent).toHaveBeenCalledWith("plan_1");
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

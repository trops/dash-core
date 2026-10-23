/**
 * Create is only for making something (consolidation Phase 3b): no Ask box
 * and no Questions & plans list in the modal. Questions are the Dash team's
 * conversations. Its start screen lists only plans you didn't finish
 * (Unfinished, QA 2026-10-22) — not finished ones, questions or widget drafts.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { CreateModal } from "./CreateModal";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => null },
}));

afterEach(() => {
  delete window.mainApi;
});

test.each(["auto", "widget", "dashboard"])(
  "Type %s: no Ask box, no Questions & plans, no unfinished widgets",
  async (initialType) => {
    window.mainApi = {
      llm: {
        checkCliAvailable: jest.fn().mockResolvedValue({ available: true }),
      },
      drafts: {
        list: jest
          .fn()
          .mockResolvedValue([{ id: "d1", name: "Tokyo clock", updatedAt: 1 }]),
      },
      bots: {
        list: jest.fn().mockResolvedValue([]),
        listLeads: jest
          .fn()
          .mockResolvedValue([{ botId: "lead_7", leadName: "Kitchen Lead" }]),
        listCreateRecent: jest.fn().mockResolvedValue([
          { id: "plan_1", title: "Counter Test", status: "built" },
          { id: "ask_1", kind: "question", title: "Which bots ran?" },
        ]),
        onCreateRecent: jest.fn(() => 9),
        removeListener: jest.fn(),
      },
    };
    render(
      <ThemeContext.Provider value={{ currentTheme: {} }}>
        <AppContext.Provider value={{ providers: {}, settings: {} }}>
          <CreateModal open setIsOpen={jest.fn()} initialType={initialType} />
        </AppContext.Provider>
      </ThemeContext.Provider>,
    );
    expect(await screen.findByTestId("create-no-ai")).toBeInTheDocument();
    expect(screen.queryByTestId("create-ask")).toBeNull();
    expect(screen.queryByText("Or ask a question")).toBeNull();
    expect(screen.queryByTestId("create-recent")).toBeNull();
    expect(screen.queryByText("Counter Test")).toBeNull();
    expect(screen.queryByText("Tokyo clock")).toBeNull();
    expect(screen.queryByText("Which bots ran?")).toBeNull();
    // Only finished work saved: no Unfinished list.
    expect(screen.queryByTestId("create-unfinished")).toBeNull();
    expect(window.mainApi.drafts.list).not.toHaveBeenCalled();
  },
);

test("an unfinished plan is listed on the start screen; Continue opens it", async () => {
  window.mainApi = {
    llm: {
      checkCliAvailable: jest.fn().mockResolvedValue({ available: true }),
    },
    bots: {
      list: jest.fn().mockResolvedValue([]),
      listLeads: jest.fn().mockResolvedValue([]),
      listCreateRecent: jest.fn().mockResolvedValue([
        {
          id: "plan_2",
          title: "Sales board",
          status: "stopped",
          updatedAt: 1,
        },
      ]),
      onCreateRecent: jest.fn(() => 9),
      removeListener: jest.fn(),
      onStream: jest.fn(() => 1),
      listDashTeam: jest.fn().mockResolvedValue([]),
      getCreateRecent: jest.fn().mockResolvedValue(null),
    },
  };
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <AppContext.Provider value={{ providers: {}, settings: {} }}>
        <CreateModal open setIsOpen={jest.fn()} initialType="dashboard" />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
  const list = await screen.findByTestId("create-unfinished");
  expect(list).toHaveTextContent("Sales board");
  expect(list).toHaveTextContent("Stopped");
  screen.getByRole("button", { name: "Continue Sales board" }).click();
  await waitFor(() =>
    expect(window.mainApi.bots.getCreateRecent).toHaveBeenCalledWith("plan_2"),
  );
  expect(screen.queryByTestId("create-no-ai")).toBeNull();
});

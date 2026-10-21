/**
 * Create is only for making something (consolidation Phase 3b): no Ask box
 * and no Questions & plans list in the modal. Both stay in the sidebar's
 * Create panel (CreateDockPanel), where questions are asked and listed.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
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
    // Nothing for them is even loaded.
    expect(window.mainApi.bots.listCreateRecent).not.toHaveBeenCalled();
    expect(window.mainApi.drafts.list).not.toHaveBeenCalled();
  },
);

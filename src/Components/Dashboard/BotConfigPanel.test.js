/**
 * BotConfigPanel — a selected bot in the edit panel: Instructions · Runs ·
 * Access (create-entry PRD CRE-006 AC5). Instructions and Access are one
 * form, kept mounted so edits survive switching; Runs is the run history.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

let mockMounts = 0;
jest.mock("../Settings/details/BotDetail", () => {
  const React = require("react");
  return {
    BotDetail: (props) => {
      React.useEffect(() => {
        mockMounts += 1;
      }, []);
      return (
        <div data-testid="bot-form">
          section={props.section} stage={String(props.stageChanges)}
          <button onClick={() => props.onChange({ name: "x" }, { name: "o" })}>
            change
          </button>
        </div>
      );
    },
  };
});
jest.mock("../Bots/BotRunHistory", () => ({
  BotRunHistory: ({ bot }) => <div data-testid="runs">runs for {bot.id}</div>,
}));

import { BotConfigPanel } from "./BotConfigPanel";

const BOT = { id: "bot_1", name: "Inbox triage" };

function setup() {
  mockMounts = 0;
  const onStage = jest.fn();
  render(
    <BotConfigPanel
      bot={BOT}
      onStage={onStage}
      formProps={{ providers: {} }}
    />,
  );
  return { onStage };
}

const tab = (name) => screen.getByRole("tab", { name });
const go = (name) => {
  fireEvent.mouseDown(tab(name));
  fireEvent.click(tab(name));
};

describe("BotConfigPanel", () => {
  test("opens on Instructions with a staged form", () => {
    setup();
    expect(tab("Instructions")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("bot-form")).toHaveTextContent(
      "section=instructions stage=true",
    );
    expect(
      screen.getByText(/wait for the dashboard's Save/),
    ).toBeInTheDocument();
  });

  test("Access shows the same form (no remount) on its access part", () => {
    setup();
    go("Access");
    expect(screen.getByTestId("bot-form")).toHaveTextContent("section=access");
    expect(mockMounts).toBe(1);
  });

  test("Runs shows the run history and keeps the form mounted, hidden", () => {
    setup();
    go("Runs");
    expect(screen.getByTestId("runs")).toHaveTextContent("bot_1");
    expect(screen.getByTestId("bot-config-form")).toHaveClass("hidden");
    go("Instructions");
    expect(mockMounts).toBe(1);
  });

  test("form changes go to onStage", () => {
    const { onStage } = setup();
    fireEvent.click(screen.getByText("change"));
    expect(onStage).toHaveBeenCalledWith({ name: "x" }, { name: "o" });
  });
});

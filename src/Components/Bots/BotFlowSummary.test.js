import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { BotFlowSummary } from "./BotFlowSummary";

const ev = (bot, event) => `bot:local/${bot}[${bot}].${event}`;
const lead = { id: "lead", name: "Algolia Lead", role: "lead" };
const planner = {
  id: "planner",
  name: "Schema Planner",
  mcpServers: ["Algolia Public HR"],
  subscriptions: [{ eventType: ev("faraway", "completed") }],
};
const reader = {
  id: "reader",
  name: "Record Reader",
  subscriptions: [{ eventType: ev("planner", "completed") }],
};
const team = [lead, planner, reader];
const nameOf = (id) => (id === "faraway" ? "Far Bot" : null);

function setup(bot, status = "Idle") {
  const onOpen = jest.fn();
  const onRunNow = jest.fn();
  render(
    <BotFlowSummary
      bot={bot}
      team={team}
      nameOf={nameOf}
      status={status}
      onOpen={onOpen}
      onRunNow={onRunNow}
    />,
  );
  return { onOpen, onRunNow };
}

describe("BotFlowSummary (TEAM-014 AC4)", () => {
  it("shows what a bot runs after (incl. other dashboards) and what it triggers", () => {
    setup(planner);
    expect(screen.getByText("Schema Planner")).toBeInTheDocument();
    expect(screen.getByText("Algolia Public HR")).toBeInTheDocument();
    expect(screen.getByTestId("runs-after")).toHaveTextContent(
      "Far Bot (other dashboard) · completed",
    );
    expect(screen.getByTestId("then-triggers")).toHaveTextContent(
      "Record Reader · completed",
    );
  });

  it("says when a bot runs after nothing / triggers nothing", () => {
    setup(reader);
    expect(screen.getByTestId("then-triggers")).toHaveTextContent(
      "Nothing yet",
    );
  });

  it("opens Conversation / Activity / Settings and Run now", () => {
    const { onOpen, onRunNow } = setup(reader);
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual([
      "conversation",
      "activity",
      "settings",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(onRunNow).toHaveBeenCalled();
  });

  it("the lead: Ask the lead, no Run now, no trigger lists", () => {
    setup(lead);
    expect(
      screen.getByRole("button", { name: "Ask the lead" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
    expect(screen.queryByTestId("runs-after")).toBeNull();
  });
});

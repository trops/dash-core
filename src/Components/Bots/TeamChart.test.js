import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TeamChart } from "./TeamChart";

const ev = (bot, event) => `bot:local/${bot}[${bot}].${event}`;
const lead = { id: "lead", name: "Algolia Lead", role: "lead" };
const planner = { id: "planner", name: "Schema Planner", subscriptions: [] };
const reader = {
  id: "reader",
  name: "Record Reader",
  subscriptions: [{ eventType: ev("planner", "completed") }],
};
const checker = {
  id: "checker",
  name: "Image Checker",
  subscriptions: [{ eventType: ev("reader", "failed") }],
};

function setup(props = {}) {
  const onSelect = jest.fn();
  const onOpen = jest.fn();
  render(
    <TeamChart
      lead={lead}
      members={[planner, reader, checker]}
      selectedId={null}
      statusOf={(id) => (id === "reader" ? "Running" : "Idle")}
      approvalsFor={(id) => (id === "checker" ? [{ id: "a1" }] : [])}
      onSelect={onSelect}
      onOpen={onOpen}
      width={1000}
      {...props}
    />,
  );
  return { onSelect, onOpen };
}

describe("TeamChart (TEAM-014 slice 1)", () => {
  it("draws the lead and every team bot with its avatar", () => {
    setup();
    expect(screen.getAllByTestId("bot-avatar")).toHaveLength(4);
    expect(screen.getByText("Algolia Lead")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Image Checker")).toBeInTheDocument();
  });

  it("draws a labelled line per trigger, dashed for failed", () => {
    setup();
    const lines = screen.getAllByTestId("diagram-edge");
    expect(lines).toHaveLength(2);
    expect(
      screen.getByTestId(`edge-label-reader|${ev("planner", "completed")}`),
    ).toHaveTextContent("completed");
    const failed = lines.find((l) => l.getAttribute("data-kind") === "failed");
    expect(failed).toHaveAttribute("stroke-dasharray");
  });

  it("selecting a bot with lines fades the others; selecting one without fades nothing", () => {
    setup({ selectedId: "planner" });
    const [toReader, toChecker] = screen.getAllByTestId("diagram-edge");
    expect(toReader).toHaveAttribute("stroke-opacity", "1");
    expect(toChecker).toHaveAttribute("stroke-opacity", "0.3");
  });

  it("selecting the lead fades nothing", () => {
    setup({ selectedId: "lead" });
    for (const l of screen.getAllByTestId("diagram-edge")) {
      expect(l).toHaveAttribute("stroke-opacity", "1");
    }
  });

  it("clicking a bot selects it", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Record Reader" }));
    expect(onSelect).toHaveBeenCalledWith("reader");
  });

  it("a selected bot shows Conversation / Activity / Settings; the lead's first is Ask the lead", () => {
    const { onOpen } = setup({ selectedId: "reader" });
    fireEvent.click(
      screen.getByRole("button", { name: "Activity — Record Reader" }),
    );
    expect(onOpen).toHaveBeenCalledWith("reader", "activity");
    fireEvent.mouseEnter(screen.getByTestId("diagram-card-lead"));
    fireEvent.click(
      screen.getByRole("button", { name: "Ask the lead — Algolia Lead" }),
    );
    expect(onOpen).toHaveBeenCalledWith("lead", "conversation");
  });

  it("a bot waiting for approval has a badge that opens its Activity", () => {
    const { onOpen } = setup();
    const c = screen.getByTestId("diagram-card-checker");
    fireEvent.click(within(c).getByRole("button", { name: "Needs approval" }));
    expect(onOpen).toHaveBeenCalledWith("checker", "activity");
  });

  it("a team with only the lead says so", () => {
    setup({ members: [] });
    expect(screen.getByText(/No bots yet/)).toBeInTheDocument();
  });
});

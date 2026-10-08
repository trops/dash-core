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

describe("TeamChart — drag to wire (TEAM-014 slice 2)", () => {
  const choicesFor = () => [
    { event: "completed", label: "Completed" },
    { event: "failed", label: "Failed" },
  ];
  function wire(props = {}) {
    const onSaveTrigger = jest.fn().mockResolvedValue(undefined);
    const onRemoveTrigger = jest.fn().mockResolvedValue(undefined);
    render(
      <TeamChart
        lead={lead}
        members={[planner, reader, checker]}
        statusOf={() => "Idle"}
        approvalsFor={() => []}
        onSelect={jest.fn()}
        onOpen={jest.fn()}
        width={1000}
        canWire
        choicesFor={choicesFor}
        onSaveTrigger={onSaveTrigger}
        onRemoveTrigger={onRemoveTrigger}
        {...props}
      />,
    );
    return { onSaveTrigger, onRemoveTrigger };
  }
  const handle = (name) =>
    screen.getByRole("button", { name: `Drag to wire ${name}` });

  it("team bots have a handle; the lead doesn't", () => {
    wire();
    expect(handle("Record Reader")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Drag to wire Algolia Lead" }),
    ).toBeNull();
  });

  it("dragging from one bot onto another opens the popover; Add trigger saves it", async () => {
    const { onSaveTrigger } = wire();
    fireEvent.pointerDown(handle("Image Checker"));
    fireEvent.pointerUp(screen.getByTestId("diagram-card-planner"));
    const dialog = screen.getByRole("dialog", {
      name: "Trigger for Schema Planner",
    });
    expect(within(dialog).getByText("after Image Checker")).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add trigger" }),
    );
    expect(onSaveTrigger).toHaveBeenCalledWith({
      mode: "add",
      sourceId: "checker",
      targetId: "planner",
      oldEventType: null,
      event: "completed",
      label: "Completed",
      note: "",
    });
  });

  it("dropping on the lead or on the same bot does nothing", () => {
    wire();
    fireEvent.pointerDown(handle("Record Reader"));
    fireEvent.pointerUp(screen.getByTestId("diagram-card-lead"));
    fireEvent.pointerDown(handle("Record Reader"));
    fireEvent.pointerUp(screen.getByTestId("diagram-card-reader"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking a line's label edits it; Remove removes it", () => {
    const { onRemoveTrigger } = wire();
    fireEvent.click(
      screen.getByTestId(`edge-label-reader|${ev("planner", "completed")}`),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Trigger for Record Reader",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(onRemoveTrigger).toHaveBeenCalledWith({
      targetId: "reader",
      eventType: ev("planner", "completed"),
    });
  });

  it("no handles while wiring is off (e.g. a bot's Settings is open)", () => {
    wire({ canWire: false });
    expect(
      screen.queryByRole("button", { name: "Drag to wire Record Reader" }),
    ).toBeNull();
  });

  it("lines in a loop are marked", () => {
    const loopPlanner = {
      ...planner,
      subscriptions: [{ eventType: ev("reader", "completed") }],
    };
    wire({ members: [loopPlanner, reader] });
    expect(
      screen.getByTestId(`edge-label-planner|${ev("reader", "completed")}`),
    ).toHaveTextContent("loop");
  });
});

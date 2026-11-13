/**
 * Which model ran it (canvas page "Which model ran it"): each step's model
 * and style, an opened step's why and where to change it, and the side's
 * Who works on this.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ModelInfoContext,
  ModelTag,
  RanOn,
  WhoWorks,
  stepRun,
} from "./ModelInfo";
import { HandoffStep } from "./HandoffStep";

const TEAM = [
  {
    id: "p",
    role: "planner",
    name: "Planner",
    runsOn: "claude-opus-5-5",
    style: "thorough",
    chosen: true,
  },
  {
    id: "b",
    role: "builder",
    name: "Builder",
    runsOn: "claude-opus-5-5",
    style: "thorough",
    chosen: true,
  },
  {
    id: "c",
    role: "checker",
    name: "Checker",
    runsOn: "claude-sonnet-5-5",
    style: "normal",
    chosen: false,
  },
  {
    id: "s",
    role: "scout",
    name: "Scout",
    runsOn: "claude-haiku-5-5",
    style: null,
    chosen: false,
  },
];

const withInfo = (node, value = {}) => (
  <ModelInfoContext.Provider
    value={{ team: TEAM, lead: null, openAiSettings: null, ...value }}
  >
    {node}
  </ModelInfoContext.Provider>
);

describe("which model ran it", () => {
  test("a hand-off takes the model its role starts on; other bots none", () => {
    expect(stepRun({ bot: "the Planner" }, TEAM)).toEqual({
      model: "claude-opus-5-5",
      style: "thorough",
      modelChosen: true,
      role: "planner",
    });
    expect(stepRun({ bot: "Inbox Watch" }, TEAM)).toEqual({});
    expect(stepRun({ bot: "the Planner" }, [])).toEqual({});
  });

  test("the tag: model and style, or Dash itself; nothing when unknown", () => {
    const { rerender } = render(
      <ModelTag run={{ model: "claude-opus-5-5", style: "thorough" }} />,
    );
    expect(screen.getByTestId("model-tag")).toHaveTextContent(
      "Opus 5.5 · Thorough",
    );
    rerender(<ModelTag run={{ dash: true }} />);
    expect(screen.getByTestId("model-tag")).toHaveTextContent("Dash itself");
    rerender(<ModelTag run={null} />);
    expect(screen.queryByTestId("model-tag")).toBeNull();
  });

  test("an opened step: ran on, why, took, and Change in Settings › AI", () => {
    const open = jest.fn();
    render(
      withInfo(
        <RanOn
          run={{
            model: "claude-opus-5-5",
            style: "thorough",
            modelChosen: true,
            role: "builder",
            tookMs: 134000,
          }}
        />,
        { openAiSettings: open },
      ),
    );
    const box = screen.getByTestId("model-ran-on");
    expect(box).toHaveTextContent("Ran onOpus 5.5 · Thorough");
    expect(box).toHaveTextContent(
      "WhyYour choice for Create · Builder in Settings › AI",
    );
    expect(box).toHaveTextContent("Took2 min 14 s");
    fireEvent.click(screen.getByText("Change in Settings › AI"));
    expect(open).toHaveBeenCalled();
  });

  test("a hand-off step shows its model on the line, and why when opened", () => {
    render(
      withInfo(
        <HandoffStep
          step={{
            bot: "the Planner",
            label: "Asked the Planner",
            status: "done",
            answer: "Here's the plan.",
            ...stepRun({ bot: "the Planner" }, TEAM),
          }}
        />,
      ),
    );
    expect(screen.getByTestId("model-tag")).toHaveTextContent(
      "Opus 5.5 · Thorough",
    );
    fireEvent.click(screen.getByText("Asked the Planner"));
    expect(screen.getByTestId("model-ran-on")).toHaveTextContent(
      "Your choice for Create · Planner in Settings › AI",
    );
  });

  test("Who works on this: each role, its model, whose choice — and the lead", () => {
    const open = jest.fn();
    render(
      withInfo(<WhoWorks />, {
        openAiSettings: open,
        lead: {
          leadName: "Smart Home Lead",
          name: "Smart Home Lead",
          runsOn: "claude-haiku-5-5",
          style: "normal",
          chosen: false,
        },
      }),
    );
    const rows = screen.getAllByTestId("workspace-who-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "PlannerYour choiceOpus 5.5 · Thorough",
      "BuilderYour choiceOpus 5.5 · Thorough",
      "CheckerBuilt inSonnet 5.5 · Normal",
      "ScoutBuilt inHaiku 5.5",
      "Smart Home LeadBuilt inHaiku 5.5 · Normal",
    ]);
    expect(screen.getByTestId("workspace-who-works")).toHaveTextContent(
      "A change applies from the next step — one already running keeps its model.",
    );
    fireEvent.click(screen.getByText("Change in Settings › AI"));
    expect(open).toHaveBeenCalled();
  });

  test("no team known: nothing shown", () => {
    render(withInfo(<WhoWorks />, { team: [] }));
    expect(screen.queryByTestId("workspace-who-works")).toBeNull();
  });
});

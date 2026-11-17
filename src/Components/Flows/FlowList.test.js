import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { FlowList, jobsNow, jobsStart } from "./FlowList";
import { RenameFlowModal } from "./RenameFlowModal";
import { installMockFlowsApi } from "../../__mocks__/mockFlowsApi";

const weekly = {
  id: "flow_w",
  name: "Weekly shopping list",
  brief: "Sundays 7:30",
  steps: [
    { id: "s", kind: "source", name: "Sunday" },
    { id: "b", kind: "bot", name: "Shopping List Maker" },
    { id: "y", kind: "you", name: "You approve" },
  ],
  where: {
    total: 3,
    running: 2,
    counts: { y: { goals: 1, ready: 1, stopped: 0 } },
  },
};
const blank = {
  id: "flow_b",
  name: "Blank",
  brief: "when you start a goal",
  steps: [
    { id: "b", kind: "bot", name: "First step" },
    { id: "y", kind: "you", name: "You" },
  ],
  where: { total: 0, running: 0, counts: {} },
};

describe("FlowList", () => {
  it("says where each flow's jobs come from and where they are now", () => {
    expect(jobsStart(weekly)).toBe("jobs start Sundays 7:30");
    expect(jobsStart(blank)).toBe("you start jobs by hand");
    expect(jobsNow(weekly)).toEqual({
      text: "1 waiting for you · 2 running",
      waiting: true,
    });
    expect(jobsNow(blank).text).toBe("No jobs now");
  });

  it("lists the flows, picks one, and starts a new one", () => {
    const onPick = jest.fn();
    const onNew = jest.fn();
    render(
      <FlowList
        flows={[weekly, blank]}
        value="flow_w"
        onPick={onPick}
        onNew={onNew}
      />,
    );
    const list = screen.getByTestId("flow-list");
    expect(list).toHaveTextContent("Flows · 2");
    expect(screen.getByTestId("flow-row-flow_w")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("flow-row-flow_w")).toHaveTextContent(
      "3 steps · jobs start Sundays 7:30",
    );
    fireEvent.click(screen.getByTestId("flow-row-flow_b"));
    expect(onPick).toHaveBeenCalledWith("flow_b");
    fireEvent.click(within(list).getByRole("button", { name: "New flow" }));
    expect(onNew).toHaveBeenCalled();
  });
});

describe("RenameFlowModal", () => {
  it("saves the new name", async () => {
    const { api } = installMockFlowsApi();
    const onRenamed = jest.fn();
    render(
      <RenameFlowModal
        flow={{ id: "flow_news01", name: "Blank" }}
        onClose={jest.fn()}
        onRenamed={onRenamed}
      />,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Weekly shopping list" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(onRenamed).toHaveBeenCalled());
    expect(api.save).toHaveBeenCalledWith("flow_news01", {
      name: "Weekly shopping list",
    });
  });
});

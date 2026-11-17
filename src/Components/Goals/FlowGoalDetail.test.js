import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { FlowGoalDetail } from "./FlowGoalDetail";
import { NewGoalModal } from "./NewGoalModal";
import { installMockFlowsApi } from "../../__mocks__/mockFlowsApi";

const flow = {
  id: "flow_t",
  name: "Ticket to PR",
  version: 2,
  maxRounds: 3,
  steps: [
    { id: "src", kind: "source", name: "Ticket reader" },
    { id: "b", kind: "bot", name: "Builder" },
    { id: "ci", kind: "check", name: "GitHub CI", check: { kind: "tool" } },
    { id: "you", kind: "you", name: "You", action: "Merge the PR" },
  ],
  edges: [
    { from: "src", to: "b", kind: "next" },
    { from: "b", to: "ci", kind: "next" },
    { from: "ci", to: "you", kind: "next" },
    { from: "ci", to: "b", kind: "fail" },
  ],
};

const failedCheck = {
  stepId: "ci",
  by: "dash",
  said: "dash",
  kind: "tool",
  status: "failed",
  round: 1,
  summary: "state equals success, but it's failure",
  details: {
    args: {},
    rules: [{ pass: false, reason: "state equals success, but it's failure" }],
  },
  at: 2,
};

const goalAt = (task, extra = {}) => ({
  id: "goal_1",
  title: "Count conversations per lead",
  workspaceId: "ws1",
  flow,
  criteria: [{ id: "c1", text: "Each lead shows its count", proof: "test" }],
  tasks: [{ id: "task_1", round: 2, maxRounds: 3, ...task }],
  ...extra,
});

const act = (fn) => fn();

describe("FlowGoalDetail", () => {
  it("a failed check: what the bot said next to what Dash checked (frame 3)", () => {
    const goal = goalAt({
      stepId: "b",
      status: "new",
      history: [
        {
          stepId: "b",
          botName: "Builder",
          said: "bot",
          status: "passed",
          summary: "npm run ci passed (exit 0).",
          round: 1,
          at: 1,
        },
        failedCheck,
      ],
    });
    render(<FlowGoalDetail goal={goal} act={act} onAction={jest.fn()} />);
    const gate = screen.getByTestId("goal-gate");
    expect(within(gate).getByText("Builder said")).toBeInTheDocument();
    expect(within(gate).getByText("Dash checked")).toBeInTheDocument();
    expect(
      within(gate).getByText(/Done\. npm run ci passed/),
    ).toBeInTheDocument();
    expect(
      within(gate).getAllByText(/state equals success, but it's failure/)
        .length,
    ).toBeGreaterThan(0);
    expect(
      within(gate).getByText(
        "Sent back to Builder for round 2 of 3, with this failure as its fix list.",
      ),
    ).toBeInTheDocument();
  });

  it("stopped after its rounds: four ways forward (frame 4)", () => {
    const onAction = jest.fn();
    const onTakeOver = jest.fn();
    const goal = goalAt({
      stepId: "ci",
      status: "needs-you",
      round: 3,
      history: [{ ...failedCheck, round: 3, stopped: true }],
    });
    render(
      <FlowGoalDetail
        goal={goal}
        act={act}
        onAction={onAction}
        onTakeOver={onTakeOver}
      />,
    );
    const box = screen.getByTestId("goal-stopped");
    expect(within(box).getByText("Stopped after 3 rounds")).toBeInTheDocument();
    fireEvent.click(
      within(box).getByRole("button", { name: "One more round" }),
    );
    expect(onAction).toHaveBeenCalledWith("task_1", "one-more-round");
    fireEvent.click(
      within(box).getByRole("button", {
        name: "Take it over in a conversation",
      }),
    );
    expect(onTakeOver).toHaveBeenCalled();
    fireEvent.click(
      within(box).getByRole("button", { name: "Change what done means" }),
    );
    expect(screen.getByTestId("criteria-editor")).toBeInTheDocument();
    fireEvent.click(within(box).getByRole("button", { name: "Close it" }));
    expect(onAction).toHaveBeenCalledWith("task_1", "close");
  });

  it("ready at your step that names what you do: one button", () => {
    const onAction = jest.fn();
    render(
      <FlowGoalDetail
        goal={goalAt({ stepId: "you", status: "ready", history: [] })}
        act={act}
        onAction={onAction}
      />,
    );
    const card = screen.getByTestId("you-waiting");
    expect(
      within(card).queryByRole("button", { name: "Send back…" }),
    ).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Merge the PR" }));
    expect(onAction).toHaveBeenCalledWith("task_1", "done");
  });

  it("approve or send back: Send back needs a reason, then sends it", () => {
    const onAction = jest.fn();
    const approving = {
      ...flow,
      steps: flow.steps.map((s) =>
        s.id === "you"
          ? { ...s, name: "You approve", mode: "approve", action: "Approve" }
          : s,
      ),
    };
    render(
      <FlowGoalDetail
        goal={goalAt(
          { stepId: "you", status: "ready", history: [] },
          { flow: approving },
        )}
        act={act}
        onAction={onAction}
      />,
    );
    const card = screen.getByTestId("you-waiting");
    expect(card).toHaveTextContent("Approve Builder's work");
    fireEvent.click(within(card).getByRole("button", { name: "Send back…" }));
    expect(card).toHaveTextContent("Send it back to Builder");
    const send = within(card).getByRole("button", { name: "Send back" });
    expect(send).toBeDisabled();
    fireEvent.change(within(card).getByRole("textbox"), {
      target: { value: "Add how to test it." },
    });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    expect(onAction).toHaveBeenCalledWith("task_1", {
      type: "send-back",
      reason: "Add how to test it.",
    });
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(onAction).toHaveBeenCalledWith("task_1", "done");
  });

  it("waiting to start: can't start until every criterion has a way to be proven (frame 30)", async () => {
    const { api } = installMockFlowsApi();
    const goal = goalAt(
      { stepId: "b", status: "new", history: [] },
      {
        waiting: true,
        criteria: [
          { id: "c1", text: "Each lead shows its count", proof: "test" },
          { id: "c2", text: "Works like the old version", proof: "none" },
        ],
      },
    );
    render(<FlowGoalDetail goal={goal} act={act} onAction={jest.fn()} />);
    expect(
      screen.getByText("Before it starts: 1 of 2 criteria can't be checked"),
    ).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Start job" });
    expect(start).toBeDisabled();
    const second = screen.getAllByTestId("criterion")[1];
    fireEvent.click(
      within(second).getByRole("button", { name: "I'll decide" }),
    );
    expect(start).not.toBeDisabled();
    fireEvent.click(start);
    await waitFor(() => expect(api.startGoal).toHaveBeenCalled());
    expect(api.startGoal.mock.calls[0][1][1].proof).toBe("you");
  });
});

describe("NewGoalModal (frame 29)", () => {
  it("flags a vague criterion with a measurable rewrite, and starts the job", async () => {
    const { api } = installMockFlowsApi();
    const onStarted = jest.fn();
    render(
      <NewGoalModal
        workspace={{ id: "ws1", name: "Dash app" }}
        flows={[{ id: "flow_t", name: "Ticket to PR" }]}
        onClose={jest.fn()}
        onStarted={onStarted}
      />,
    );
    fireEvent.change(screen.getByLabelText("What should be done"), {
      target: { value: "Count conversations per lead" },
    });
    // Optional and folded away; opening it gives an empty row, which
    // doesn't stop the job starting.
    fireEvent.click(screen.getByText("+ Add what done means (optional)"));
    expect(
      screen.getByRole("button", { name: "Start job" }),
    ).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Criterion 1"), {
      target: { value: "It should feel fast" },
    });
    const row = screen.getByTestId("criterion");
    expect(
      await within(row).findByText("Nothing can check this as written."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(row).getByRole("button", {
        name: /Use: "It opens in under 200 ms"/,
      }),
    );
    expect(screen.getByLabelText("Criterion 1")).toHaveValue(
      "It opens in under 200 ms",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start job" }));
    await waitFor(() => expect(api.newGoal).toHaveBeenCalled());
    expect(api.newGoal.mock.calls[0][1]).toMatchObject({
      flowId: "flow_t",
      title: "Count conversations per lead",
      criteria: [{ text: "It opens in under 200 ms", proof: "test" }],
    });
    expect(onStarted).toHaveBeenCalled();
  });
});

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BotTestOutput, botFacts } from "./BotTestOutput";

const DEFINITION = {
  name: "Meeting Reminder",
  instructions: "List today's meetings.",
  mcpServers: ["Google Calendar"],
  schedules: [{ cron: "0 8 * * 1-5", prompt: "Today's meetings" }],
  publishes: [{ name: "reminders", label: "Reminders" }],
};
const STEP = {
  id: "testbot:0",
  kind: "testbot",
  label: "Test Meeting Reminder",
  status: "needs-you",
  definition: DEFINITION,
};
const SAMPLE = { at: "t", answer: "{}", results: [], shape: {} };

let resolveTest;
beforeEach(() => {
  window.mainApi = {
    bots: {
      test: jest.fn(
        () =>
          new Promise((r) => {
            resolveTest = r;
          }),
      ),
      stop: jest.fn(),
      onStream: jest.fn(() => "s1"),
      removeListener: jest.fn(),
      listApprovals: jest.fn().mockResolvedValue([]),
      onApprovalsChanged: jest.fn(() => "a1"),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

describe("botFacts", () => {
  it("says when it runs, what it uses and what it shows", () => {
    expect(botFacts(DEFINITION)).toEqual([
      "Runs every weekday at 8:00 AM",
      "Uses Google Calendar",
      "Shows Reminders",
    ]);
    expect(botFacts({})).toEqual(["Runs when asked"]);
  });
});

describe("BotTestOutput", () => {
  it("Save turns on once a test finishes, and keeps that test", async () => {
    const pb = { approve: jest.fn().mockResolvedValue({}), actionError: null };
    render(<BotTestOutput step={STEP} pb={pb} onChange={jest.fn()} />);
    expect(screen.getByText("Test Meeting Reminder")).toBeInTheDocument();
    expect(screen.getByText("Save the bot")).toBeDisabled();
    expect(
      screen.getByText("Test it first: Save turns on once a test finishes."),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText(
        "What it's asked on its schedule: Today's meetings",
      ),
      { target: { value: "Tomorrow's" } },
    );
    fireEvent.click(screen.getByText("Test"));
    const [definition, opts] = window.mainApi.bots.test.mock.calls[0];
    expect(definition).toBe(DEFINITION);
    expect(opts.prompt).toBe("Tomorrow's");
    await act(async () => {
      resolveTest({ status: "completed", answer: "{}", sample: SAMPLE });
    });
    expect(
      screen.getByText(/kept as its sample when you save it/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save the bot"));
    expect(pb.approve).toHaveBeenCalledWith("testbot:0", { sample: SAMPLE });
  });

  it("Change something goes to the Planner", () => {
    const onChange = jest.fn();
    render(
      <BotTestOutput
        step={STEP}
        pb={{ approve: jest.fn() }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Change something"));
    fireEvent.change(screen.getByLabelText("What should change?"), {
      target: { value: "only meetings with others" },
    });
    fireEvent.click(screen.getByText("Send to the Planner"));
    expect(onChange).toHaveBeenCalledWith(
      "Change Meeting Reminder: only meetings with others",
    );
  });

  it("without a way to change the plan, there's no Change something", () => {
    render(<BotTestOutput step={STEP} pb={{ approve: jest.fn() }} />);
    expect(screen.queryByText("Change something")).toBeNull();
  });

  it("a step with no bot to test says so", () => {
    render(
      <BotTestOutput
        step={{ ...STEP, definition: null }}
        pb={{ approve: jest.fn() }}
      />,
    );
    expect(screen.getByText(/can't be tested here/)).toBeInTheDocument();
  });
});

describe("BotTestOutput — a build saved before Dash last closed", () => {
  it("says to carry on building first, with no test to run for nothing", () => {
    render(
      <BotTestOutput
        step={STEP}
        pb={{ approve: jest.fn(), restored: true }}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId("bot-test-restored")).toHaveTextContent(
      /Carry on building in the chat/,
    );
    expect(screen.queryByText("Test")).toBeNull();
    expect(screen.queryByText("Save the bot")).toBeNull();
  });
});

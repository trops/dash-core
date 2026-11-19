import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestResult } from "./TestResult";

const DONE = {
  phase: "done",
  testId: "test-abc123",
  result: {
    status: "completed",
    startedAt: "2026-11-18T10:00:00Z",
    endedAt: "2026-11-18T10:00:14Z",
    toolCalls: [{ tool: "web_search" }],
    answer: '{"deals":[{"title":"Skillet","price":24.99}]}',
    shape: {
      kind: "json",
      top: "object",
      fields: [
        { path: "deals", kind: "list", count: 1 },
        { path: "deals[].title", kind: "text" },
        { path: "deals[].price", kind: "number" },
      ],
    },
    results: [{ name: "deals", label: "Deals", items: [{ title: "Skillet" }] }],
    resultsShape: [
      { name: "deals", label: "Deals", count: 1, fields: ["title"] },
    ],
    sampleKept: true,
  },
};

beforeEach(() => {
  window.mainApi = {
    bots: {
      listApprovals: jest.fn().mockResolvedValue([]),
      onApprovalsChanged: jest.fn(() => "l1"),
      removeListener: jest.fn(),
    },
  };
});

afterEach(() => {
  delete window.mainApi;
});

describe("TestResult", () => {
  it("shows nothing before a test", () => {
    const { container } = render(<TestResult test={{ phase: "idle" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("while testing: what it's doing, its answer so far, and Stop", () => {
    const onStop = jest.fn();
    render(
      <TestResult
        test={{
          phase: "testing",
          testId: "test-abc123",
          startedAt: Date.now(),
          text: '{ "deals": [',
          activity: "Using web search",
        }}
        botName="Deal Finder"
        onStop={onStop}
      />,
    );
    expect(screen.getByText("Testing Deal Finder…")).toBeInTheDocument();
    expect(screen.getByText(/^Using web search · \d+s$/)).toBeInTheDocument();
    expect(screen.getByText('{ "deals": [')).toBeInTheDocument();
    fireEvent.click(screen.getByText("Stop"));
    expect(onStop).toHaveBeenCalled();
  });

  it("asks before a tool acts, without Always allow", async () => {
    window.mainApi.bots.listApprovals.mockResolvedValue([
      {
        id: "a1",
        request: {
          botId: "test-abc123",
          serverName: "gmail",
          toolName: "send_email",
        },
      },
    ]);
    render(
      <TestResult
        test={{ phase: "testing", testId: "test-abc123", startedAt: 1 }}
        botName="Deal Finder"
      />,
    );
    expect(
      await screen.findByText(
        "This is a test, but what it does is real if you allow it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.queryByText("Always allow")).toBeNull();
  });

  it("when done: the answer, its shape and the results it would have sent", () => {
    render(<TestResult test={DONE} botName="Deal Finder" />);
    expect(screen.getByText("Tested")).toBeInTheDocument();
    expect(screen.getByText("What Deal Finder returned")).toBeInTheDocument();
    expect(screen.getByText("14s · 1 tool call")).toBeInTheDocument();
    expect(
      screen.getByText(/kept as Deal Finder's sample/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bot-test-shape")).toHaveTextContent(
      "dealslista list of 1titletextpricenumber",
    );
    expect(screen.getByTestId("bot-test-answer")).toHaveTextContent(
      '"price": 24.99',
    );
    fireEvent.click(screen.getByText("Show as text"));
    expect(screen.getByTestId("bot-test-answer")).toHaveTextContent(
      '"price":24.99',
    );
    expect(screen.getByText("Results it would have sent")).toBeInTheDocument();
    expect(screen.getByText('to widgets showing "Deals"')).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show items"));
    expect(screen.getByTestId("bot-test-results")).toHaveTextContent(
      '"title": "Skillet"',
    );
  });

  it("a plain-text answer has no fields and says how to get them", () => {
    render(
      <TestResult
        test={{
          phase: "done",
          result: {
            answer: "Skillet $24.99",
            shape: { kind: "text", lines: 1, chars: 14 },
          },
        }}
        botName="Deal Finder"
      />,
    );
    expect(
      screen.getByText("Text · 1 line · 14 characters"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("bot-test-shape")).toBeNull();
    expect(
      screen.getByText(/Ask for JSON in its instructions/),
    ).toBeInTheDocument();
  });

  it("when it didn't finish: why, and Test again", () => {
    const onTestAgain = jest.fn();
    render(
      <TestResult
        test={{
          phase: "failed",
          error: "Web search isn't connected on this computer.",
          result: {
            startedAt: "2026-11-18T10:00:00Z",
            endedAt: "2026-11-18T10:00:04Z",
          },
        }}
        onTestAgain={onTestAgain}
      />,
    );
    expect(screen.getByText("Didn't finish")).toBeInTheDocument();
    expect(screen.getByText("after 4s")).toBeInTheDocument();
    expect(
      screen.getByText("Web search isn't connected on this computer."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Test again"));
    expect(onTestAgain).toHaveBeenCalled();
  });

  it("a stopped test says so", () => {
    render(<TestResult test={{ phase: "stopped", result: {} }} />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(
      screen.getByText("You stopped the test before it answered."),
    ).toBeInTheDocument();
  });
});

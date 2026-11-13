/**
 * Your answer on top: after you send, your message is at the top of the
 * view and the team's work fills the room below it.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AskStep } from "./AskStep";
import { TOP_GAP, placeAnswer, sentIndex } from "./answerOnTop";

describe("sentIndex — was it a send of yours?", () => {
  const you = (text) => ({ who: "you", text });
  const reply = (text) => ({ who: "planner", text });

  test("your new message at the end", () => {
    expect(sentIndex(2, [you("a"), reply("b"), you("c")])).toBe(2);
  });
  test("your message and a step line with it", () => {
    expect(
      sentIndex(2, [you("a"), reply("b"), you("c"), { who: "step", id: "s" }]),
    ).toBe(2);
  });
  test("a reply coming in is not a send", () => {
    expect(sentIndex(1, [you("a"), reply("b")])).toBe(-1);
  });
  test("a saved conversation loading all at once is not a send", () => {
    expect(sentIndex(0, [you("a"), reply("b"), you("c"), reply("d")])).toBe(-1);
  });
  test("the first message of a new conversation is", () => {
    expect(sentIndex(0, [you("a")])).toBe(0);
  });
});

describe("placeAnswer — where the view goes", () => {
  test("short work below: your message on top, room fills the rest", () => {
    expect(
      placeAnswer({
        anchorTop: 900,
        contentHeight: 1000,
        viewHeight: 600,
        away: false,
      }),
    ).toEqual({
      room: 600 - (1000 - (900 - TOP_GAP)),
      scrollTop: 900 - TOP_GAP,
    });
  });
  test("the work no longer fits: it follows the newest part", () => {
    expect(
      placeAnswer({
        anchorTop: 900,
        contentHeight: 2000,
        viewHeight: 600,
        away: false,
      }),
    ).toEqual({ room: 0, scrollTop: 1400 });
  });
  test("you scrolled away to read: it leaves you there", () => {
    expect(
      placeAnswer({
        anchorTop: 900,
        contentHeight: 2000,
        viewHeight: 600,
        away: true,
      }).scrollTop,
    ).toBeNull();
  });
});

describe("AskStep — your answer is the one held on top", () => {
  afterEach(() => {
    delete window.mainApi;
  });

  test("reopened: no message held; your next one is", async () => {
    window.mainApi = {
      bots: {
        listDashTeam: jest
          .fn()
          .mockResolvedValue([
            { id: "b_planner", role: "planner", name: "Planner" },
          ]),
        onStream: jest.fn(() => 1),
        removeListener: jest.fn(),
        run: jest.fn().mockResolvedValue({
          status: "completed",
          output: "One failed.",
        }),
        saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_q1" }),
        getCreateRecent: jest.fn().mockResolvedValue({
          id: "plan_q1",
          kind: "question",
          prompt: "What ran?",
          conversation: {
            messages: [
              { who: "you", text: "What ran?" },
              { who: "planner", text: "Two bots." },
            ],
          },
        }),
        listCreateRecent: jest.fn().mockResolvedValue([]),
        onCreateRecent: jest.fn(() => 3),
      },
      drafts: { list: jest.fn().mockResolvedValue([]) },
    };
    render(<AskStep recentId="plan_q1" />);
    await screen.findByText("Two bots.");
    expect(screen.queryByTestId("answer-on-top")).toBeNull();
    fireEvent.change(screen.getByLabelText("Ask a follow-up"), {
      target: { value: "Which failed?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() =>
      expect(screen.getByTestId("answer-on-top")).toHaveTextContent(
        "Which failed?",
      ),
    );
  });
});

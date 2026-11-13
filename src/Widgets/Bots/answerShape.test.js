/**
 * A bot's answer read as its structure (approved mockup "Bot widgets that
 * look like Dash", frames 1 and 2).
 */
import { actionState, answerShape, itemOf } from "./answerShape";

const SUMMARY = `I'll search Gmail for unread emails from the last day.

You have 7 unread emails from the last 24 hours; 3 matter.

1. **Dana Whitfield** — asks whether the Q4 budget review can move to Thursday afternoon. *Action:* reply.
2. **City Water Utility**: your November bill of $64.20 is ready. Action: pay by Nov 24.
- Google - New sign-in to your account from a Mac in Boston.
  Action needed: check it was you.

4 newsletters and notifications left out.`;

describe("answerShape", () => {
  test("a list answer: the line before it, one item each, what follows", () => {
    const s = answerShape(SUMMARY);
    expect(s.kind).toBe("list");
    expect(s.lead).toBe(
      "You have 7 unread emails from the last 24 hours; 3 matter.",
    );
    expect(s.items).toEqual([
      {
        title: "Dana Whitfield",
        gist: "asks whether the Q4 budget review can move to Thursday afternoon.",
        action: "Reply",
      },
      {
        title: "City Water Utility",
        gist: "your November bill of $64.20 is ready.",
        action: "Pay by Nov 24",
      },
      {
        title: "Google",
        gist: "New sign-in to your account from a Mac in Boston.",
        action: "Check it was you",
      },
    ]);
    expect(s.tail).toBe("4 newsletters and notifications left out.");
  });

  test("a short answer is said on its own — the narration before it isn't", () => {
    expect(
      answerShape(
        "Searching Gmail now.\n\nYou have no unread emails from the last 24 hours.",
      ),
    ).toMatchObject({
      kind: "short",
      text: "You have no unread emails from the last 24 hours.",
      // The whole answer, kept.
      paragraphs: [
        "Searching Gmail now.",
        "You have no unread emails from the last 24 hours.",
      ],
    });
  });

  test("a short last line after a real result isn't said alone", () => {
    const s = answerShape(
      "3 lights are on: kitchen, porch, garage.\n\nGarage door is open.\n\nI turned off the porch light.",
    );
    expect(s.kind).toBe("text");
    expect(s.paragraphs).toHaveLength(3);
  });

  test("a long answer with no list stays text; nothing is none", () => {
    const long = "word ".repeat(80).trim();
    expect(answerShape(long)).toEqual({ kind: "text", paragraphs: [long] });
    expect(answerShape("  \n ").kind).toBe("none");
  });

  test("an item with no title separator keeps its words as the title", () => {
    expect(itemOf("Back up finished at 3 AM")).toEqual({
      title: "Back up finished at 3 AM",
      gist: "",
      action: "",
    });
    expect(itemOf("**Lights:** 3 left on downstairs")).toEqual({
      title: "Lights",
      gist: "3 left on downstairs",
      action: "",
    });
  });

  // Found in review.
  test("an action only where a sentence starts, short enough for a badge", () => {
    expect(itemOf("Bob — the action: plan is set and we wait for him")).toEqual(
      {
        title: "Bob",
        gist: "the action: plan is set and we wait for him",
        action: "",
      },
    );
    expect(
      itemOf(
        "Bob — says hi. Action: reply soon, but only if the meeting moves to Thursday afternoon",
      ),
    ).toMatchObject({ action: "" });
    expect(itemOf("Bob — wants the deck (action: reply) by Friday")).toEqual({
      title: "Bob",
      gist: "wants the deck by Friday",
      action: "Reply",
    });
  });

  test("Re: and Fwd: stay in the title; a dash wins over a colon", () => {
    expect(itemOf("Re: Invoice 443 — from Bob").title).toBe("Re: Invoice 443");
    expect(itemOf("Fwd: lunch: Friday works").title).toBe("Fwd: lunch");
    expect(itemOf("Meeting re: budget — Bob").title).toBe("Meeting re: budget");
    expect(itemOf("Standup at 7:00 AM: moved").title).toBe(
      "Standup at 7:00 AM",
    );
    expect(itemOf("https://example.com/a — the link").title).toBe(
      "https://example.com/a",
    );
  });

  test("nested entries join their parent; headings and notes between stay in place", () => {
    const s = answerShape(
      [
        "Two groups.",
        "",
        "Inbox",
        "- Dana — the review",
        "  - child one: detail",
        "",
        "Note: two left out.",
        "",
        "- Bob — lunch",
      ].join("\n"),
    );
    expect(s.items).toEqual([
      { title: "Dana", gist: "the review; child one: detail", action: "" },
      { note: "Note: two left out." },
      { title: "Bob", gist: "lunch", action: "" },
    ]);
    expect(s.lead).toBe("Inbox");
  });

  test("an action's tone", () => {
    expect(actionState("Check it was you")).toBe("error");
    expect(actionState("Reply needed")).toBe("warning");
    expect(actionState("Pay by Nov 24")).toBe("info");
    expect(actionState("Read later")).toBe("neutral");
  });
});

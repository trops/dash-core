/**
 * A job step as its bot's message (DASH-123): prose and handoff apart, the
 * handoff as a card, long text shortened at a word, the JSON on request.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  handoffCard,
  handoffJson,
  keyLabel,
  shortenMarkdown,
  shortenText,
  splitStepText,
  stepParts,
} from "./stepView";
import { startLineText, startedByText, whyText } from "./jobText";
import { JobsPage } from "./JobsPage";

const T = "2026-11-27T12:56:00.000Z";

describe("stepView", () => {
  it("takes an older step's handoff JSON out of its text, whole or cut off", () => {
    const whole =
      'DASH-97 is first. ```json {"status": "ok", "summary": "Took DASH-97"} ``` Done.';
    expect(splitStepText(whole)).toEqual({
      prose: "DASH-97 is first.\n\nDone.",
      handoff: { status: "ok", summary: "Took DASH-97" },
      cut: false,
    });
    // Clipped mid-string, as steps were kept before DASH-123.
    const clipped =
      'DASH-97 is first. ```json {"status": "ok", "body": "Part of DASH-94\\n\\nIn code-factory-sandbox, lower-…';
    expect(splitStepText(clipped)).toEqual({
      prose: "DASH-97 is first.",
      handoff: null,
      cut: true,
    });
    expect(splitStepText("Words then ```json")).toEqual({
      prose: "Words then",
      handoff: null,
      cut: true,
    });
    expect(splitStepText('{"status":"none"}')).toEqual({
      prose: "",
      handoff: { status: "none" },
      cut: false,
    });
    // A bash block is prose.
    expect(splitStepText("Ran ```bash npm test ```").handoff).toBeNull();
    expect(splitStepText("Ran ```bash npm test ```").cut).toBe(false);
    expect(splitStepText("")).toEqual({ prose: "", handoff: null, cut: false });
  });

  it("a newer step keeps them apart already", () => {
    expect(
      stepParts({ summary: "Hi **there**", handoff: { status: "ok" } }),
    ).toEqual({ prose: "Hi **there**", handoff: { status: "ok" }, cut: false });
    expect(stepParts(null)).toEqual({ prose: "", handoff: null, cut: false });
  });

  it("shortens at a word boundary, and Markdown never inside a block", () => {
    const s = "one two three four five six seven";
    const short = shortenText(s, 12);
    expect(short).toEqual({ text: "one two…", cut: true });
    expect(shortenText("short", 12)).toEqual({ text: "short", cut: false });
    // One long word: cut at the limit.
    expect(shortenText("x".repeat(30), 10).text).toBe(`${"x".repeat(10)}…`);
    const md = `Intro words here.\n\n\`\`\`js\n${"const a = 1;\n".repeat(20)}\`\`\`\nAfter.`;
    const m = shortenMarkdown(md, 60);
    expect(m.cut).toBe(true);
    expect(m.text).toBe("Intro words here.\n\n…");
    expect((m.text.match(/```/g) || []).length % 2).toBe(0);
    expect(shortenMarkdown("Plain words.", 60)).toEqual({
      text: "Plain words.",
      cut: false,
    });
  });

  it("makes a handoff's card: status, item link, summary, picks, details", () => {
    const job = {
      item: { id: "DASH-97", url: "https://x.test/browse/DASH-97" },
      picks: { repo: "code-factory-sandbox" },
    };
    const card = handoffCard(
      {
        status: "ok",
        item: { id: "DASH-97", title: "titleCase", source: "jira" },
        summary: "Took DASH-97",
        repo: "code-factory-sandbox",
        body: "Part of DASH-94",
        notes: { nested: true },
      },
      job,
    );
    expect(card.status).toEqual({
      label: "Handed on",
      word: "OK",
      tone: "success",
    });
    expect(card.item).toEqual({
      id: "DASH-97",
      title: "titleCase",
      source: "jira",
      url: "https://x.test/browse/DASH-97",
      label: "Ticket",
    });
    expect(card.summary).toBe("Took DASH-97");
    expect(card.picks).toEqual([
      { name: "repo", value: "code-factory-sandbox" },
    ]);
    // Only plain values are details; the rest is in the JSON.
    expect(card.details).toEqual([
      { key: "body", label: "Details", text: "Part of DASH-94" },
    ]);
    const picked = handoffCard({ picks: { repo: "a" }, summary: "x" });
    expect(picked.status.word).toBe("OK");
    expect(picked.picks).toEqual([{ name: "repo", value: "a" }]);
    expect(handoffCard({ status: "none" }).status.word).toBe("Nothing to do");
    expect(
      handoffCard({
        status: "split",
        items: ["A-1", { id: "A-2", title: "t" }],
      }).items,
    ).toEqual(["A-1", "A-2 · t"]);
    expect(handoffCard({ status: "weird" }).status.tone).toBe("error");
    expect(handoffCard(null)).toBeNull();
    expect(keyLabel("nextStep")).toBe("Next step");
    expect(keyLabel("test_plan")).toBe("Test plan");
    expect(handoffJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("a self-test's words (DASH-123)", () => {
  const test = {
    leadId: null,
    leadName: "Ticket Bot",
    startedBy: { kind: "you", label: "Test team" },
    test: true,
    status: "running",
    createdAt: T,
  };
  it("says the self-test started it, not 'You ran Test team'", () => {
    expect(startedByText(test)).toBe("Self-test started by you");
    expect(whyText({ kind: "you" }, test)).toBe("Started by the self-test");
    expect(whyText({ kind: "you" })).toBe("You asked");
    expect(whyText({ kind: "handon", by: "Ticket Bot", label: "Done" })).toBe(
      "Handed on by Ticket Bot",
    );
    const now = Date.parse(T) + 7 * 60000;
    const line = startLineText(test, now);
    expect(line).toMatch(/^Self-test started by you · .+ · running 7 min$/);
    expect(
      startLineText(
        {
          leadId: "l",
          leadName: "Woodworking Lead",
          status: "done",
          createdAt: T,
          endedAt: new Date(Date.parse(T) + 120000).toISOString(),
        },
        now,
      ),
    ).toMatch(/^Started by you, in Woodworking Lead · .+ · 2 min$/);
  });
});

describe("a step on the Jobs page (DASH-123)", () => {
  const answer = {
    summary: "DASH-97 is first. Next I'll move it to **In Progress**.",
    handoff: {
      status: "ok",
      item: { id: "DASH-97", title: "titleCase" },
      summary: "Took DASH-97",
      body: `Part of DASH-94. ${"In code-factory-sandbox titleCase leaves the rest unchanged. ".repeat(8)}`,
    },
  };
  const job = {
    id: "job_t",
    workspaceId: "1",
    leadId: null,
    leadName: "Ticket Bot",
    title: "Test: Ticket Bot on DASH-97",
    startedBy: { kind: "you", label: "Test team" },
    test: true,
    skippedInTest: [],
    item: { id: "DASH-97", url: "https://x.test/browse/DASH-97" },
    status: "done",
    createdAt: T,
    updatedAt: T,
    endedAt: T,
    steps: [
      {
        id: "t1",
        botId: "tb",
        botName: "Ticket Bot",
        status: "done",
        why: { kind: "you" },
      },
      {
        id: "t2",
        botId: "tr",
        botName: "Triage",
        status: "done",
        why: { kind: "handon", by: "Ticket Bot" },
      },
    ],
  };
  const opened = [];
  beforeEach(() => {
    opened.length = 0;
    window.mainApi = {
      shell: { openExternal: jest.fn((u) => opened.push(u)) },
      bots: {
        listJobs: jest.fn(async () => [job]),
        getJob: jest.fn(async () => ({
          ...job,
          steps: [
            { ...job.steps[0], ...answer },
            // An older step: its handoff JSON in its text, cut off.
            {
              ...job.steps[1],
              summary:
                'One repo. ```json {"status": "ok", "picks": {"repo": "code-factory-sa',
            },
          ],
        })),
        onJobsChanged: jest.fn(() => "1"),
        removeListener: jest.fn(),
      },
    };
  });
  afterEach(() => {
    delete window.mainApi;
  });

  it("shows each step as its bot's message, its handoff as a card and no JSON", async () => {
    render(<JobsPage workspaces={[{ id: 1, name: "Factory" }]} />);
    const detail = await screen.findByTestId("job-detail");
    await waitFor(() =>
      expect(within(detail).getAllByTestId("handoff-card")).toHaveLength(1),
    );
    expect(within(detail).getByTestId("job-start-line").textContent).toMatch(
      /^Factory · Self-test started by you · /,
    );
    const [first, second] = within(detail).getAllByTestId("job-step");
    expect(within(first).getByText("Ticket Bot")).toBeInTheDocument();
    expect(within(first).getByText("Started by the self-test")).toBeTruthy();
    expect(within(second).getByText("Handed on by Ticket Bot")).toBeTruthy();
    // Markdown, not raw text.
    expect(
      within(first).getByTestId("job-step-prose").querySelector("strong")
        .textContent,
    ).toBe("In Progress");
    // No JSON anywhere by default.
    expect(detail.textContent).not.toMatch(/```|"status"/);
    expect(within(second).getByTestId("handoff-cut")).toBeInTheDocument();
    expect(within(second).getByText("One repo.")).toBeInTheDocument();
    // The work item links to its URL (the job's).
    fireEvent.click(within(first).getByTestId("handoff-item-link"));
    expect(opened).toEqual(["https://x.test/browse/DASH-97"]);
    expect(within(first).getByTestId("handoff-summary").textContent).toMatch(
      "Took DASH-97",
    );
    // A long detail is shortened at a word, with Show more.
    const detailRow = within(first).getByTestId("handoff-detail");
    expect(detailRow.textContent).toMatch(/…/);
    fireEvent.click(within(detailRow).getByText("Show more"));
    expect(detailRow.textContent).not.toMatch(/…/);
    // Show handoff JSON: pretty-printed.
    fireEvent.click(within(first).getByText("Show handoff JSON"));
    expect(within(first).getByTestId("handoff-json").textContent).toBe(
      JSON.stringify(answer.handoff, null, 2),
    );
    fireEvent.click(within(first).getByText("Hide handoff JSON"));
    expect(within(first).queryByTestId("handoff-json")).toBeNull();
    // The cut-off one has nothing to show.
    expect(within(second).queryByText("Show handoff JSON")).toBeNull();
  });
});

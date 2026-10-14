/**
 * contactsList — the Bots dock's contacts (bot-teams TEAM-015): what each row
 * says, grouping by dashboard, Recent vs A–Z, search.
 */
import {
  contactOf,
  contactSections,
  firstWaiting,
  shortTime,
} from "./contactsList";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();

const workspaces = [
  { id: 1, name: "Slack Pack" },
  { id: 2, name: "Morning Brief" },
];
const bots = [
  { id: "sl", name: "Slack Pack Lead", role: "lead", workspaceId: 1 },
  { id: "cs", name: "Channel Summarizer", workspaceId: "1" },
  { id: "is", name: "Inbox Sorter", workspaceId: 2 },
  { id: "pr", name: "PR Digest", workspaceId: null },
  { id: "q", name: "Quiet One", workspaceId: 2 },
];
const lastRuns = {
  sl: { at: ago(300), status: "completed", text: "All quiet", error: "" },
  cs: {
    at: ago(12),
    status: "completed",
    text: "Posted the digest",
    error: "",
  },
  is: { at: ago(60), status: "completed", text: "Sorted 14", error: "" },
  pr: {
    at: ago(3000),
    status: "failed",
    text: "",
    error: "GitHub sign-in expired",
  },
};

describe("contactOf — what a row says", () => {
  const base = { running: [], approvals: [], paused: new Set(), now: NOW };

  test("the latest answer, or a failure with why, or nothing yet", () => {
    expect(contactOf(bots[1], { ...base, last: lastRuns.cs })).toMatchObject({
      status: "Idle",
      line: "Posted the digest",
      at: lastRuns.cs.at,
      isLead: false,
    });
    expect(contactOf(bots[3], { ...base, last: lastRuns.pr })).toMatchObject({
      status: "Failed",
      line: "Failed · GitHub sign-in expired",
    });
    expect(contactOf(bots[4], { ...base, last: null })).toMatchObject({
      status: "Idle",
      line: "Hasn't run yet",
      at: null,
    });
  });

  test("needs approval beats running beats paused", () => {
    const approvals = [
      {
        id: "a1",
        createdAt: ago(2),
        request: { botId: "is", toolName: "gmail.send" },
      },
    ];
    const running = [{ id: "is", startedAt: ago(1) }];
    const paused = new Set(["is"]);
    expect(
      contactOf(bots[2], { ...base, last: lastRuns.is, paused }),
    ).toMatchObject({ status: "Paused", line: "Paused" });
    expect(
      contactOf(bots[2], { ...base, last: lastRuns.is, paused, running }),
    ).toMatchObject({ status: "Running", line: "Running now…", at: ago(1) });
    expect(
      contactOf(bots[2], {
        ...base,
        last: lastRuns.is,
        paused,
        running,
        approvals,
      }),
    ).toMatchObject({
      status: "Needs approval",
      line: "Needs approval · gmail.send",
      approvals: 1,
      at: ago(2),
    });
  });
});

describe("contactSections — grouping and sorting", () => {
  const args = { bots, workspaces, lastRuns, now: NOW };
  const names = (sections) =>
    sections.map((s) => [s.label, s.contacts.map((c) => c.name)]);

  test("Recent, by team: newest team first, newest bot first, no dashboard as its own group", () => {
    expect(names(contactSections(args))).toEqual([
      ["Slack Pack", ["Channel Summarizer", "Slack Pack Lead"]],
      ["Morning Brief", ["Inbox Sorter", "Quiet One"]],
      ["No dashboard", ["PR Digest"]],
    ]);
  });

  test("a bot waiting on you comes first, and so does its team", () => {
    const approvals = [
      { id: "a", createdAt: ago(500), request: { botId: "q", toolName: "x" } },
    ];
    const s = contactSections({ ...args, approvals });
    expect(s[0].label).toBe("Morning Brief");
    expect(s[0].contacts[0].name).toBe("Quiet One");
  });

  test("A–Z: teams and bots by name, no dashboard last", () => {
    expect(names(contactSections({ ...args, sort: "az" }))).toEqual([
      ["Morning Brief", ["Inbox Sorter", "Quiet One"]],
      ["Slack Pack", ["Channel Summarizer", "Slack Pack Lead"]],
      ["No dashboard", ["PR Digest"]],
    ]);
  });

  test("not by team: one list", () => {
    expect(names(contactSections({ ...args, byTeam: false }))).toEqual([
      [
        "All bots",
        [
          "Channel Summarizer",
          "Inbox Sorter",
          "Slack Pack Lead",
          "PR Digest",
          "Quiet One",
        ],
      ],
    ]);
  });

  test("search by name; nothing matching → no sections", () => {
    expect(names(contactSections({ ...args, query: "inbox" }))).toEqual([
      ["Morning Brief", ["Inbox Sorter"]],
    ]);
    expect(contactSections({ ...args, query: "zzz" })).toEqual([]);
  });
});

test("firstWaiting: the first approval for a bot in the list", () => {
  const approvals = [
    { request: { botId: "gone" } },
    { request: { botId: "is" } },
  ];
  expect(firstWaiting(approvals, bots)).toBe("is");
  expect(firstWaiting([], bots)).toBeNull();
});

test("shortTime: now, minutes, hours, then a day", () => {
  expect(shortTime(ago(0), NOW)).toBe("now");
  expect(shortTime(ago(12), NOW)).toBe("12m");
  expect(shortTime(ago(300), NOW)).toBe("5h");
  expect(shortTime(ago(60 * 24 * 2), NOW)).toMatch(/^[A-Za-z]{3}/);
  expect(shortTime(null, NOW)).toBe("");
});

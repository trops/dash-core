import {
  AVATAR_COLORS,
  approvalText,
  avatarColor,
  botHandle,
  botProviders,
  lastRunsByBot,
} from "./botSummary";

describe("botHandle (app-navigation NAV-006 AC2)", () => {
  it("is local/<slug> of the name", () => {
    expect(botHandle({ id: "b1", name: "Inbox Watch" })).toBe(
      "local/inbox-watch",
    );
    expect(botHandle({ id: "b2", name: "  Urgent: Email -- Digest! " })).toBe(
      "local/urgent-email-digest",
    );
  });

  it("uses a published name when there is one, else the id", () => {
    expect(
      botHandle({ id: "b1", name: "Inbox", registryName: "@john/inbox" }),
    ).toBe("@john/inbox");
    expect(botHandle({ id: "bot_9" })).toBe("local/bot-9");
  });
});

describe("avatarColor", () => {
  it("is stable for a bot and one of the avatar colours", () => {
    const a = avatarColor({ id: "bot_123" });
    expect(AVATAR_COLORS).toContain(a);
    expect(avatarColor({ id: "bot_123" })).toBe(a);
  });

  it("spreads different bots across colours", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => avatarColor({ id })),
    );
    expect(colors.size).toBeGreaterThan(2);
  });
});

describe("lastRunsByBot", () => {
  it("takes each bot's newest run from the recent-runs list", () => {
    const recent = [
      { botId: "b1", run: { status: "failed", endedAt: "2026-10-03T10:00Z" } },
      { botId: "b2", run: { status: "completed" } },
      { botId: "b1", run: { status: "completed" } },
    ];
    expect(lastRunsByBot(recent)).toEqual({
      b1: { status: "failed", endedAt: "2026-10-03T10:00Z" },
      b2: { status: "completed" },
    });
    expect(lastRunsByBot(undefined)).toEqual({});
  });
});

describe("botProviders", () => {
  it("lists each granted provider with its chosen tools", () => {
    expect(
      botProviders({
        mcpServers: ["Gmail 3", "Slack"],
        toolSelections: { "Gmail 3": ["search_emails", "read_email"] },
      }),
    ).toEqual([
      { name: "Gmail 3", tools: ["search_emails", "read_email"] },
      { name: "Slack", tools: [] },
    ]);
  });

  it("a lead uses team tools only; no providers is an empty list", () => {
    expect(botProviders({ role: "lead", mcpServers: ["Gmail 3"] })).toEqual([]);
    expect(botProviders({})).toEqual([]);
  });
});

describe("approvalText", () => {
  it("says what the bot wants to use", () => {
    expect(
      approvalText({
        request: { toolName: "send_email", serverName: "Gmail 3" },
      }),
    ).toBe("Wants to use send_email on Gmail 3.");
    expect(approvalText({ request: { toolName: "Bash" } })).toBe(
      "Wants to use Bash.",
    );
    expect(approvalText(null)).toBe("Wants your approval.");
  });
});

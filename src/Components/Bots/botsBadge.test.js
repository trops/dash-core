import { botsBadge } from "./botsBadge";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const bots = [
  { id: "lead", name: "Lead", role: "lead" },
  { id: "coder", name: "Coder" },
  { id: "rev", name: "Reviewer" },
];
const failedAt = (iso) => ({
  status: "failed",
  endedAt: iso,
  error: "boom",
});

describe("botsBadge — the Bots switch's count", () => {
  it("nothing: no count, no label, no target", () => {
    expect(botsBadge({ bots, now: NOW })).toEqual({
      count: 0,
      approvals: [],
      failed: [],
      label: "",
      target: null,
    });
  });

  it("a failed last run: says which bot and opens it", () => {
    const b = botsBadge({
      bots,
      lastRunByBot: { coder: failedAt("2026-11-27T11:00:00Z") },
      now: NOW,
    });
    expect(b.count).toBe(1);
    expect(b.label).toBe("1 bot's last run failed: Coder");
    expect(b.target).toEqual({ botId: "coder", tab: "activity" });
  });

  it("dismissing the failure in the panel clears it, until it fails again", () => {
    const run = failedAt("2026-11-27T11:00:00Z");
    const dismissed = { "failed:coder": Date.parse(run.endedAt) };
    expect(
      botsBadge({ bots, lastRunByBot: { coder: run }, dismissed, now: NOW })
        .count,
    ).toBe(0);
    const again = failedAt("2026-11-27T11:30:00Z");
    expect(
      botsBadge({ bots, lastRunByBot: { coder: again }, dismissed, now: NOW })
        .count,
    ).toBe(1);
  });

  it("a passed run, a bot running now, or a week-old failure isn't counted", () => {
    expect(
      botsBadge({
        bots,
        lastRunByBot: {
          coder: { status: "completed", endedAt: "2026-11-27T11:00:00Z" },
          rev: failedAt("2026-11-27T11:00:00Z"),
          lead: failedAt("2026-11-01T11:00:00Z"),
        },
        running: ["rev"],
        now: NOW,
      }).count,
    ).toBe(0);
  });

  it("asks for an OK count and can't be dismissed; they come first", () => {
    const b = botsBadge({
      bots,
      approvals: [
        { id: "a1", request: { botId: "rev" } },
        { id: "a2", request: { botId: "other-team" } },
      ],
      lastRunByBot: { coder: failedAt("2026-11-27T11:00:00Z") },
      dismissed: { "approval:a1": NOW },
      now: NOW,
    });
    expect(b.count).toBe(2);
    expect(b.approvals).toEqual([{ botId: "rev", name: "Reviewer" }]);
    expect(b.failed).toEqual([{ botId: "coder", name: "Coder" }]);
    expect(b.label).toBe(
      "1 ask waits for your OK: Reviewer (answer Allow or Deny) · 1 bot's last run failed: Coder",
    );
    expect(b.target).toEqual({ botId: "rev", tab: "activity" });
  });

  it("plural wording", () => {
    const b = botsBadge({
      bots,
      lastRunByBot: {
        coder: failedAt("2026-11-27T11:00:00Z"),
        rev: failedAt("2026-11-27T10:00:00Z"),
      },
      now: NOW,
    });
    expect(b.label).toBe("2 bots' last run failed: Coder, Reviewer");
  });
});

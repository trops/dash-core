import {
  sameWorkspace,
  dashboardOptions,
  groupBotsByTeam,
  triggerSummary,
  offTeamSubscriptions,
} from "./teamUtils";

const workspaces = [
  { id: 7, name: "Kitchen Sink" },
  { id: 9, name: "Kitchen Sink" },
  { id: 3, name: "Sales" },
];

describe("teamUtils", () => {
  it("sameWorkspace compares ids as strings; empty = unassigned", () => {
    expect(sameWorkspace(7, "7")).toBe(true);
    expect(sameWorkspace(null, "")).toBe(true);
    expect(sameWorkspace(undefined, null)).toBe(true);
    expect(sameWorkspace("7", "9")).toBe(false);
    expect(sameWorkspace("7", null)).toBe(false);
  });

  it("dashboardOptions numbers same-named dashboards", () => {
    expect(dashboardOptions(workspaces)).toEqual([
      { value: "7", label: "Kitchen Sink (1)" },
      { value: "9", label: "Kitchen Sink (2)" },
      { value: "3", label: "Sales" },
    ]);
    expect(dashboardOptions(null)).toEqual([]);
  });

  it("groupBotsByTeam groups by dashboard, Unassigned last", () => {
    const bots = [
      { id: "a", name: "A", workspaceId: "3" },
      { id: "b", name: "B", workspaceId: 7 },
      { id: "c", name: "C", workspaceId: null },
      { id: "d", name: "D", workspaceId: "404" }, // dashboard gone
      { id: "e", name: "E", workspaceId: "3" },
    ];
    const groups = groupBotsByTeam(bots, workspaces);
    expect(groups.map((g) => [g.label, g.bots.map((b) => b.id)])).toEqual([
      ["Kitchen Sink (1)", ["b"]],
      ["Sales", ["a", "e"]],
      ["Unassigned", ["c", "d"]],
    ]);
    expect(groups[2].workspaceId).toBeNull();
  });

  it("groupBotsByTeam omits empty teams and handles no bots", () => {
    expect(groupBotsByTeam([], workspaces)).toEqual([]);
  });

  it("triggerSummary describes schedule + events in plain words", () => {
    expect(triggerSummary({})).toBe("Runs manually");
    expect(
      triggerSummary({
        schedules: [{ cron: "0 7 * * 1-5" }],
        subscriptions: [],
      }),
    ).toBe("On a schedule");
    expect(
      triggerSummary({
        schedules: [{ cron: "0 7 * * *" }],
        subscriptions: [{ eventType: "x" }, { eventType: "y" }],
      }),
    ).toBe("On a schedule · on 2 events");
    expect(triggerSummary({ subscriptions: [{ eventType: "x" }] })).toBe(
      "On 1 event",
    );
  });

  it("offTeamSubscriptions finds widget events from other dashboards", () => {
    const subs = [
      { eventType: "W[1].x", source: { kind: "widget", workspaceId: "7" } },
      { eventType: "W[2].y", source: { kind: "widget", workspaceId: "9" } },
      { eventType: "legacy" },
      { eventType: "bot:x[b].completed", source: { kind: "bot" } },
    ];
    expect(offTeamSubscriptions(subs, "7").map((s) => s.eventType)).toEqual([
      "W[2].y",
    ]);
    // Unassigned bots hear every dashboard — nothing is off-team.
    expect(offTeamSubscriptions(subs, null)).toEqual([]);
  });
});

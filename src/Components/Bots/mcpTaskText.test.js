import {
  whenText,
  setOnText,
  taskRow,
  routeRow,
  approvalForTasks,
  taskTimesText,
} from "./mcpTaskText";

const NOW = new Date(2026, 10, 1, 9, 20).getTime();
const at = (h, m, day = 1) => new Date(2026, 10, day, h, m).toISOString();

const task = (over = {}) => ({
  id: "task_1",
  task: "Design the guest bedroom, boho, lots of plants",
  teamName: "Room Design",
  from: "ha-bridge",
  status: "waiting",
  createdAt: at(9, 14),
  expiresAt: at(9, 24),
  ...over,
});

describe("mcpTaskText", () => {
  it("says when: today, yesterday, or the date", () => {
    expect(whenText(at(9, 4), NOW)).toMatch(/^9:04/);
    expect(whenText(new Date(2026, 9, 31, 19, 40).toISOString(), NOW)).toMatch(
      /^yesterday 7:40/,
    );
    expect(whenText(new Date(2026, 9, 28, 8, 0).toISOString(), NOW)).toMatch(
      /^Oct 28, 8:00/,
    );
    expect(setOnText(at(8, 0))).toBe("Set Nov 1");
    expect(setOnText(null)).toBe("");
  });

  it("waiting, running, done, failed, expired", () => {
    const w = taskRow(task(), { now: NOW });
    expect(w.meta).toMatch(/^via MCP · ha-bridge · 9:14/);
    expect(w.tag).toMatch(/^Waiting for passphrase · expires 9:24/);
    expect(w.state).toBe("pending");
    expect(w.summary).toBe("Waiting for the passphrase. Nothing has started.");

    const confirmed = { confirmedAt: at(9, 15) };
    const r = taskRow(task({ status: "running", ...confirmed }), { now: NOW });
    expect(r.meta).toMatch(/· confirmed with passphrase ·/);
    expect([r.tag, r.state]).toEqual(["Running", "info"]);

    const d = taskRow(
      task({ status: "done", summary: "Added to Rooms.", ...confirmed }),
      { now: NOW },
    );
    expect([d.tag, d.state, d.summary, d.open]).toEqual([
      "Done",
      "success",
      "Added to Rooms.",
      false,
    ]);

    const f = taskRow(task({ status: "failed", error: "It was stopped." }), {
      now: NOW,
    });
    expect([f.tag, f.summary]).toEqual(["Didn't finish", "It was stopped."]);

    const e = taskRow(task({ status: "expired" }), { now: NOW });
    expect(e.tag).toBe("Expired — no passphrase");
    expect(e.state).toBe("neutral");
  });

  it("a paused bot leaves it needing the user, not done", () => {
    const n = taskRow(
      task({
        status: "done",
        summary: "Laid it out.",
        needsYou: "Designer didn't run: this bot is paused.",
      }),
      { now: NOW },
    );
    expect([n.tag, n.state, n.open]).toEqual(["Needs you", "warning", true]);
    expect(n.summary).toBe("Designer didn't run: this bot is paused.");
  });

  it("a waiting approval shows on the task, with Open", () => {
    const a = taskRow(task({ status: "running" }), {
      approval: "Designer wants to send an email.",
      now: NOW,
    });
    expect([a.tag, a.summary, a.open]).toEqual([
      "Waiting for your approval",
      "Designer wants to send an email.",
      true,
    ]);
    // Not on a task that hasn't started.
    expect(taskRow(task(), { approval: "x", now: NOW }).tag).toMatch(
      /^Waiting for passphrase/,
    );
  });

  it("a task the Dash team routed says so", () => {
    const r = taskRow(task({ routedBy: "dash-team" }), { now: NOW });
    expect(r.meta).toMatch(/^via MCP · routed by Dash team for ha-bridge/);
  });

  it("the newest confirmed task gets the team's approval asked after it started", () => {
    const tasks = [
      task({ id: "t3" }), // waiting — not started
      task({ id: "t2", status: "running", confirmedAt: at(9, 10) }),
      task({ id: "t1", status: "done", confirmedAt: at(9, 0) }),
    ];
    const team = new Set(["b7"]);
    const describe = (a) => `${a.request.botId} asks`;
    expect(
      approvalForTasks(
        tasks,
        [{ request: { botId: "b7" }, createdAt: at(9, 12) }],
        team,
        describe,
      ),
    ).toEqual({ taskId: "t2", text: "b7 asks" });
    // Asked before the task started, or by another team's bot: not it.
    expect(
      approvalForTasks(
        tasks,
        [
          { request: { botId: "b7" }, createdAt: at(9, 5) },
          { request: { botId: "x" }, createdAt: at(9, 12) },
        ],
        team,
        describe,
      ),
    ).toBe(null);
  });

  it("a finished task doesn't take an approval asked long after it ended", () => {
    const done = [
      task({
        id: "t1",
        status: "done",
        confirmedAt: at(9, 0),
        endedAt: at(9, 5),
      }),
    ];
    const team = new Set(["b7"]);
    const describe = () => "asks";
    // Its bot's own scheduled run, hours later: not the task's.
    expect(
      approvalForTasks(
        done,
        [{ request: { botId: "b7" }, createdAt: at(15, 0) }],
        team,
        describe,
      ),
    ).toBe(null);
    // Still waiting just after the lead answered: the task's.
    expect(
      approvalForTasks(
        done,
        [{ id: "a1", request: { botId: "b7" }, createdAt: at(9, 6) }],
        team,
        describe,
      ),
    ).toEqual({ taskId: "t1", text: "asks", id: "a1" });
  });

  it("a row's summary is plain text", () => {
    const r = taskRow(
      task({
        status: "done",
        summary: '**Added** to `Rooms`.\n<route>{"teams":["7"]}</route>',
      }),
      { now: NOW },
    );
    expect(r.summary).toBe("Added to Rooms.");
  });

  it("an opened task's times", () => {
    expect(
      taskTimesText(
        task({ status: "done", confirmedAt: at(9, 4), endedAt: at(9, 11) }),
        NOW,
      ),
    ).toMatch(/^Started 9:04 AM · Done 9:11 AM$/);
    expect(taskTimesText(task(), NOW)).toBe("");
  });

  it("routing log rows: sent, asked back, none, couldn't", () => {
    const base = { at: at(9, 4), from: "ha-bridge", task: "Fix up the garage" };
    const s = routeRow(
      { ...base, team: { id: "7", name: "Room Design" } },
      NOW,
    );
    expect(s.title).toBe("Sent 'Fix up the garage' to Room Design");
    expect(s.meta).toMatch(/^via MCP · ha-bridge · 9:04/);
    expect(s.tag).toBe("Sent");
    const a = routeRow(
      { ...base, ambiguous: ["Room Design", "Home Projects"] },
      NOW,
    );
    expect(a.title).toBe("Asked back: Room Design or Home Projects?");
    expect(a.meta).toMatch(/'Fix up the garage'$/);
    expect(routeRow({ ...base, none: true }, NOW).title).toBe(
      "No team takes tasks like 'Fix up the garage'",
    );
    expect(
      routeRow({ ...base, error: "The Dash Lead is busy." }, NOW).summary,
    ).toBe("The Dash Lead is busy. The agent asked which team instead.");
  });
});

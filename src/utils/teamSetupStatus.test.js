/**
 * teamSetupStatus (DASH-119): a team's setup status — bots with a required
 * setting still empty, plus what the last Check setup found that settings
 * can't say — and the words the badge, banner and Run now use.
 */
import {
  teamSetupStatus,
  setupSentence,
  cantStartText,
  needsSetupIds,
} from "./teamSetupStatus";

const lead = { id: "lead", name: "Lead", role: "lead", workspaceId: 7 };
const ticket = {
  id: "tb",
  name: "Ticket Bot",
  workspaceId: 7,
  settings: [
    { name: "source", label: "Where tickets come from", required: true },
  ],
  settingValues: {},
};
const triage = {
  id: "tr",
  name: "Triage",
  workspaceId: 7,
  settings: [{ name: "repos", label: "Repos", type: "table", required: true }],
  settingValues: { repos: [{ key: "a", url: "https://github.com/o/a" }] },
};
const workspace = {
  id: "wb",
  name: "Workspace Bot",
  workspaceId: 7,
  settings: [{ name: "workFolder", label: "Work folder", type: "folder" }],
  instructions: "Clone into {workFolder}",
  settingValues: {},
};
const coder = { id: "co", name: "Coder", workspaceId: 7 };

describe("teamSetupStatus", () => {
  it("is ready when no bot needs anything", () => {
    const s = teamSetupStatus({ bots: [lead, triage, coder] });
    expect(s.ready).toBe(true);
    expect(s.count).toBe(0);
    expect(s.badge).toBeNull();
    expect(s.first).toBeNull();
    expect(setupSentence(s)).toBe("");
    expect(cantStartText(s)).toBeNull();
  });

  it("counts bots with a required (or used) setting empty, in team order", () => {
    const s = teamSetupStatus({
      bots: [lead, ticket, triage, workspace, coder],
    });
    expect(s.ready).toBe(false);
    expect(s.count).toBe(2);
    expect(s.bots.map((b) => b.name)).toEqual(["Ticket Bot", "Workspace Bot"]);
    expect(s.first).toEqual({ botId: "tb", name: "Ticket Bot" });
    expect(s.badge).toBe("Setup · 2 bots need you");
    expect(s.short).toBe("Setup · 2");
    expect([...needsSetupIds(s)]).toEqual(["tb", "wb"]);
  });

  it("says one bot in the singular", () => {
    const s = teamSetupStatus({ bots: [workspace] });
    expect(s.badge).toBe("Setup · 1 bot needs you");
  });

  it("leaves out leads and Dash team bots", () => {
    const s = teamSetupStatus({
      bots: [
        { ...ticket, id: "l2", role: "lead" },
        { ...ticket, id: "d1", system: "dash-team" },
      ],
    });
    expect(s.ready).toBe(true);
  });

  it("counts a team setting a bot uses, against that bot", () => {
    const bot = { id: "x", name: "Builder", instructions: "Use {repoUrl}" };
    const team = {
      declared: [{ name: "repoUrl", label: "Repo URL" }],
      values: {},
    };
    const s = teamSetupStatus({ bots: [bot], team });
    expect(s.bots[0].missing[0]).toMatchObject({
      name: "repoUrl",
      owner: "team",
    });
  });

  it("adds a failed Check setup's other problems: on their bot (by id or name), or on no one bot", () => {
    const check = {
      ok: false,
      problems: [
        // Settings problems come from the bots as saved now: left out.
        { kind: "setting", botId: "tb", message: "Ticket Bot: … has no value" },
        {
          kind: "repo-read",
          botId: "tr",
          bot: "Triage",
          message: "Triage can't read o/a",
        },
        {
          kind: "provider",
          bot: "Coder",
          message: "Coder's provider GitHub isn't working",
        },
        {
          kind: "ai-login",
          bots: [],
          message: "Your default AI can't sign in",
        },
      ],
    };
    const s = teamSetupStatus({ bots: [lead, triage, coder], check });
    expect(s.bots.map((b) => [b.name, b.problems])).toEqual([
      ["Triage", ["Triage can't read o/a"]],
      ["Coder", ["Coder's provider GitHub isn't working"]],
    ]);
    expect(s.other).toEqual(["Your default AI can't sign in"]);
    expect(s.count).toBe(2);
  });

  it("a check that passed adds nothing; problems on no one bot alone still need you", () => {
    expect(
      teamSetupStatus({
        bots: [triage],
        check: { ok: true, problems: [] },
      }).ready,
    ).toBe(true);
    const s = teamSetupStatus({
      bots: [triage],
      check: {
        ok: false,
        problems: [{ kind: "ai-login", message: "No login" }],
      },
    });
    expect(s.ready).toBe(false);
    expect(s.count).toBe(0);
    expect(s.first).toBeNull();
    expect(s.badge).toBe("Setup · 1 problem to fix");
  });

  it("filling the setting in clears it without another check", () => {
    const check = {
      ok: false,
      problems: [{ kind: "setting", botId: "wb", message: "Workspace Bot: …" }],
    };
    const filled = { ...workspace, settingValues: { workFolder: "~/work" } };
    expect(teamSetupStatus({ bots: [filled], check }).ready).toBe(true);
  });
});

describe("setupSentence / cantStartText", () => {
  const s = teamSetupStatus({ bots: [ticket, workspace] });

  it("names each bot and what it needs, then what to do next", () => {
    expect(setupSentence(s)).toBe(
      "Ticket Bot needs “Where tickets come from” filled in, and Workspace Bot needs “Work folder” filled in. Then run Check setup and a self-test.",
    );
  });

  it("says why a Run or a task can't start", () => {
    expect(cantStartText(s)).toBe(
      "This team can't take work yet: Ticket Bot needs “Where tickets come from” filled in; Workspace Bot needs “Work folder” filled in.",
    );
  });

  it("lists several settings on one bot, and a check's problems", () => {
    const bot = {
      id: "m",
      name: "Multi",
      settings: [
        { name: "a", label: "A", required: true },
        { name: "b", label: "B", required: true },
        { name: "c", label: "C", required: true },
      ],
    };
    const st = teamSetupStatus({
      bots: [bot, coder],
      check: {
        ok: false,
        problems: [
          { kind: "provider", bot: "Coder", message: "x" },
          { kind: "ai-login", message: "y" },
        ],
      },
    });
    expect(setupSentence(st)).toBe(
      "Multi needs “A”, “B” and “C” filled in, Coder has 1 problem from Check setup, and Check setup found 1 problem on no one bot. Then run Check setup and a self-test.",
    );
    expect(cantStartText(st)).toMatch(/; Check setup found 1 problem\.$/);
  });
});

describe("an untested change (DASH-121)", () => {
  it("is counted in the badge without making the team not ready", () => {
    const team = { untested: { what: "Coder changed", at: "x" } };
    const s = teamSetupStatus({ bots: [triage, coder], team });
    expect(s.ready).toBe(true);
    expect(s.untested).toBe("Coder changed");
    expect(s.badge).toBe("Setup · untested change");
    expect(s.short).toBe("Untested");
    expect(cantStartText(s)).toBeNull();
    expect(setupSentence(s)).toBe("");
    // A team that needs something keeps that badge, and the change too.
    const t = teamSetupStatus({ bots: [ticket], team });
    expect(t.ready).toBe(false);
    expect(t.badge).toBe("Setup · 1 bot needs you");
    expect(t.untested).toBe("Coder changed");
    expect(teamSetupStatus({ bots: [coder] }).untested).toBeNull();
  });
});

/**
 * teamChecklist (DASH-120): the team page's Set up checklist, its cards and
 * steps.
 */
import {
  botSetupCards,
  cardState,
  checklistLine,
  checklistSteps,
  draftChanged,
} from "./teamChecklist";

const folder = { name: "workFolder", label: "Work folder", required: true };
const ws = {
  id: "ws",
  name: "Workspace Bot",
  description: "Clones the repo it's handed.",
  settings: [folder],
  settingValues: {},
};
const triage = {
  id: "tr",
  name: "Triage",
  settings: [{ name: "note", label: "Note" }],
  settingValues: {},
};
const lead = { id: "l", name: "Lead", role: "lead", settings: [folder] };

describe("botSetupCards", () => {
  it("has a card per bot with a required setting of its own", () => {
    const cards = botSetupCards([lead, ws, triage, { id: "x", name: "X" }]);
    expect(cards.map((c) => c.botId)).toEqual(["ws"]);
    expect(cards[0]).toMatchObject({
      name: "Workspace Bot",
      about: "Clones the repo it's handed.",
      ready: false,
      dirty: false,
    });
    expect(cardState(cards[0])).toBe("1 to fill in");
  });

  it("uses the draft being edited, and says Ready once it's filled in", () => {
    const [card] = botSetupCards([ws], { ws: { workFolder: "~/Work" } });
    expect(card.ready).toBe(true);
    expect(card.dirty).toBe(true);
    expect(card.values).toEqual({ workFolder: "~/Work" });
    expect(cardState(card)).toBe("✓ Ready");
  });

  it("keeps a filled-in required bot (Ready), so it can be changed", () => {
    const done = { ...ws, settingValues: { workFolder: "~/Work" } };
    expect(botSetupCards([done])[0].ready).toBe(true);
  });
});

describe("draftChanged", () => {
  it("compares values, not identity", () => {
    expect(draftChanged({ a: 1 }, { a: 1 })).toBe(false);
    expect(draftChanged({ a: 1 }, { a: 2 })).toBe(true);
    expect(draftChanged(undefined, {})).toBe(false);
    expect(draftChanged({}, { rows: [] })).toBe(true);
  });
});

describe("checklistSteps", () => {
  it("lists settings, Check setup and the self-test; repo checks when it has repos", () => {
    const r = checklistSteps({ cards: botSetupCards([ws]) });
    expect(r.steps.map((s) => s.key)).toEqual(["settings", "check", "test"]);
    expect(r.steps.map((s) => s.state)).toEqual([
      "1 bot to fill in",
      "Not checked yet",
      "Not tested yet",
    ]);
    expect(r.done).toBe(0);
    const withRepos = checklistSteps({
      repos: { shown: true, missing: 2, closed: 0 },
    });
    expect(withRepos.steps.map((s) => s.key)).toEqual([
      "settings",
      "check",
      "repos",
      "test",
    ]);
    expect(withRepos.steps[2].state).toBe("2 repos have no checks yet");
  });

  it("marks each step done from its own state", () => {
    const r = checklistSteps({
      cards: [],
      teamEmpty: 0,
      check: { ok: true, problems: [] },
      repos: { shown: true, missing: 0, closed: 0 },
      test: { lastTest: { at: "2026-11-27T00:00:00Z" } },
    });
    expect(r.steps.every((s) => s.done)).toBe(true);
    expect(checklistLine(r)).toBe("All 4 done");
    const later = checklistSteps({
      check: { ok: false, problems: [{ message: "a" }, { message: "b" }] },
      teamEmpty: 1,
      test: { lastTest: { at: "x" }, untested: { what: "Coder changed" } },
    });
    expect(later.steps.map((s) => [s.done, s.state])).toEqual([
      [false, "1 team setting empty"],
      [false, "2 problems to fix"],
      [false, "Untested change"],
    ]);
    expect(checklistLine(later)).toBe("0 of 3 done · do them in order");
  });
});

describe("the self-test's item field (DASH-121)", () => {
  it("takes the package's testItem setting, else a ticket when a bot takes tickets, else generic", () => {
    const { testItemField } = require("./teamChecklist");
    expect(
      testItemField({
        team: {
          declared: [
            {
              name: "testItem",
              label: "Sample note",
              description: "A note in your test folder",
            },
          ],
        },
      }),
    ).toEqual({
      label: "Sample note",
      placeholder: "A note in your test folder",
    });
    expect(
      testItemField({
        bots: [{ id: "t", settings: [{ name: "source", type: "tracker" }] }],
      }),
    ).toEqual({
      label: "Test ticket",
      placeholder: "A ticket in your sandbox project",
    });
    const plain = testItemField({ bots: [{ id: "c" }] });
    expect(plain).toEqual({
      label: "Test item",
      placeholder: "A test ticket key",
    });
    expect(JSON.stringify(plain)).not.toMatch(/DASH-97/);
  });
});

describe("selfTestBlock (DASH-121)", () => {
  it("waits for filled-in, saved settings and a passing Check setup", () => {
    const { selfTestBlock } = require("./teamChecklist");
    const ok = { ok: true, problems: [] };
    expect(selfTestBlock({ dirty: true, check: ok, item: "T-1" })).toBe(
      "Save your changes in step 1 first.",
    );
    expect(selfTestBlock({ waiting: 1, check: ok, item: "T-1" })).toBe(
      "Fill in the settings in step 1 first.",
    );
    expect(selfTestBlock({ item: "T-1" })).toBe(
      "Run Check setup in step 2 first.",
    );
    expect(
      selfTestBlock({
        check: { ok: false, problems: [{}, {}, {}] },
        item: "T-1",
      }),
    ).toBe("Fix the 3 problems in step 2 first.");
    expect(selfTestBlock({ check: ok, item: " " })).toBe(
      "Type a test item first.",
    );
    expect(selfTestBlock({ check: ok, item: "T-1" })).toBeNull();
  });
});

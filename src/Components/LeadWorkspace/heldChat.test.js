/**
 * The build held to your choices, in the chat (canvas page "The build is
 * held to your choices"): fixing by itself, it matches, the end of the line.
 */
import {
  buildChat,
  heldOf,
  heldLines,
  heldRows,
  withRuns,
} from "./workspaceBuild";

const MISMATCH = [
  {
    main: "It calls ha_delete_event, which changes things",
    chose: "only reads — it never changes anything",
  },
  {
    main: "There is no “Days ahead” setting",
    chose: "Days ahead, starting at 1 — a setting you can change later",
  },
];
const ROWS = [
  {
    ok: true,
    main: "Reads from Home Assistant MCP",
    sub: "uses your connection",
  },
  { ok: true, main: "Only reads", sub: "calls ha_config_get_calendar_events" },
];

const stateOf = (steps, made = {}, status = "running") => ({
  status,
  steps,
  made,
});
const build = (status) => ({
  id: "build:0",
  kind: "build",
  piece: 0,
  role: "builder",
  label: "Build My Calendar Today",
  status,
});
const check = (status, extra = {}) => ({
  id: "check:0",
  kind: "check",
  piece: 0,
  role: "checker",
  label: "Check My Calendar Today",
  status,
  ...extra,
});
const preview = (status) => ({
  id: "preview:0",
  kind: "preview",
  piece: 0,
  label: "Preview My Calendar Today",
  status,
});

describe("held to your choices — in the chat", () => {
  test("fixing by itself: what didn't match, nothing for the user to do", () => {
    const state = stateOf(
      [build("running"), check("waiting"), preview("waiting")],
      { 0: { mismatch: MISMATCH, held: { rows: [] } } },
    );
    const chat = buildChat(state, { kind: "cell" });
    expect(chat.step).toEqual({
      label: "Checked — 2 things didn't match what you chose",
      status: "failed",
      link: "check",
    });
    expect(chat.lines[0]).toEqual({
      label: "Builder is fixing them, then it's checked again",
      status: "asking",
    });
    expect(chat.off).toBe(MISMATCH);
    expect(chat.reply).toMatch(/bringing it in line with what you chose/);
    expect(chat.reply).toMatch(/nothing for you to do/);
    expect(chat.choices).toBeNull();
  });

  test("it matches, after the Builder fixed two things", () => {
    const state = stateOf(
      [build("done"), check("done"), preview("needs-you")],
      { 0: { held: { rows: ROWS, fixed: 2 } } },
      "waiting-for-you",
    );
    const chat = buildChat(state, { kind: "cell" });
    expect(chat.lines).toEqual([
      { label: "Builder fixed 2 things to match your choices", status: "done" },
      {
        label: "Checked — it matches every choice you made",
        status: "done",
        link: "check",
      },
      // Then the Checker (which model ran it: its own line).
      { label: "Checker passed it", status: "done", role: "checker" },
    ]);
    expect(chat.choices).toBe("preview");
  });

  test("which model ran it: each line with its run, Dash's own check as Dash itself", () => {
    const state = stateOf(
      [
        {
          ...build("done"),
          model: "claude-opus-5-5",
          style: "thorough",
          modelChosen: true,
          tookMs: 134000,
        },
        { ...check("done"), model: "claude-sonnet-5-5", style: "normal" },
        preview("needs-you"),
      ],
      { 0: { held: { rows: ROWS } } },
      "waiting-for-you",
    );
    const chat = withRuns(buildChat(state, { kind: "cell" }), state);
    expect(chat.step.run).toEqual({
      model: "claude-opus-5-5",
      style: "thorough",
      modelChosen: true,
      tookMs: 134000,
      role: "builder",
    });
    expect(chat.lines.map((l) => l.run)).toEqual([
      { dash: true },
      {
        model: "claude-sonnet-5-5",
        style: "normal",
        modelChosen: false,
        tookMs: null,
        role: "checker",
      },
    ]);
  });

  test("nothing chosen to hold it to: no lines", () => {
    expect(heldLines({ held: { rows: [] } })).toEqual([]);
    expect(heldLines(null)).toEqual([]);
  });

  test("the end of the line: what, the closest that works, nothing installed", () => {
    const end = {
      what: "all-day events have no time, so eventClicked can't carry one",
      closest: "send them without a time",
    };
    const state = stateOf(
      [
        { ...build("failed"), endOfLine: end, error: "the Builder can't: x" },
        check("skipped"),
        preview("skipped"),
      ],
      {},
      "finished-with-problems",
    );
    const chat = buildChat(state, { kind: "cell" });
    expect(chat.choices).toBe("endofline");
    expect(chat.closest).toBe("send them without a time");
    expect(chat.step.label).toBe("Builder can't do one thing you chose");
    expect(chat.off).toEqual([{ main: end.what, chose: null }]);
    expect(chat.reply).toMatch(/Nothing was installed/);
  });

  test("after a restart, the end of the line carries on building first", () => {
    const state = stateOf(
      [
        { ...build("failed"), endOfLine: { what: "x", closest: "y" } },
        check("skipped"),
      ],
      {},
      "finished-with-problems",
    );
    const chat = buildChat(state, { kind: "cell", restored: true });
    expect(chat.choices).toBe("continue");
    expect(chat.continueLabel).toBe("Carry on building");
  });

  test("a mismatch no fix could change: its rows, with what was chosen", () => {
    const state = stateOf(
      [
        build("done"),
        check("failed", {
          endOfLine: { what: "- x", closest: null },
          error: "1 thing doesn't match",
        }),
      ],
      { 0: { mismatch: [MISMATCH[0]], held: { rows: ROWS } } },
      "finished-with-problems",
    );
    const chat = buildChat(state, { kind: "cell" });
    expect(chat.step.label).toBe(
      "Checked — 1 thing can't be done as you chose",
    );
    expect(chat.off).toEqual([MISMATCH[0]]);
    expect(chat.closest).toBeNull();
  });

  test("the Check report: what doesn't match first, then what does", () => {
    const state = stateOf([build("running"), check("waiting")], {
      0: { mismatch: [MISMATCH[0]], held: { rows: ROWS } },
    });
    expect(heldOf(state).mismatch).toEqual([MISMATCH[0]]);
    expect(heldRows(state)).toEqual([
      {
        ok: false,
        main: MISMATCH[0].main,
        sub: `You chose: ${MISMATCH[0].chose}`,
      },
      ...ROWS,
    ]);
  });
});

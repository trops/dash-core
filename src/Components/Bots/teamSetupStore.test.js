/**
 * teamSetupStore (DASH-119): the last Check setup per team, and the signal
 * that a team's setup changed.
 */
import {
  rememberSetupCheck,
  lastSetupCheck,
  noteSetupChanged,
  onSetupChanged,
  _resetSetupStore,
} from "./teamSetupStore";

afterEach(() => _resetSetupStore());

describe("teamSetupStore", () => {
  it("keeps a team's last check (ok, problems, off, at), by id as a string", () => {
    rememberSetupCheck(7, {
      ok: false,
      problems: [{ kind: "repo-read", message: "x" }],
      off: [{ botId: "c", bot: "Coder", command: "npm test" }],
      at: "2026-11-27T10:00:00Z",
      text: "…",
    });
    expect(lastSetupCheck("7")).toEqual({
      ok: false,
      problems: [{ kind: "repo-read", message: "x" }],
      off: [{ botId: "c", bot: "Coder", command: "npm test" }],
      at: "2026-11-27T10:00:00Z",
    });
    expect(lastSetupCheck(8)).toBeNull();
    expect(lastSetupCheck(null)).toBeNull();
  });

  it("a result that isn't a check (an error) forgets the last one", () => {
    rememberSetupCheck(7, { ok: true, problems: [] });
    rememberSetupCheck(7, { error: "Which team?" });
    expect(lastSetupCheck(7)).toBeNull();
  });

  it("tells listeners which team changed, until they unsubscribe", () => {
    const seen = [];
    const off = onSetupChanged((id) => seen.push(id));
    rememberSetupCheck(7, { ok: true, problems: [] });
    noteSetupChanged(9);
    off();
    noteSetupChanged(9);
    expect(seen).toEqual(["7", "9"]);
  });

  it("one listener's error doesn't stop the others", () => {
    const seen = [];
    onSetupChanged(() => {
      throw new Error("boom");
    });
    onSetupChanged((id) => seen.push(id));
    noteSetupChanged(3);
    expect(seen).toEqual(["3"]);
  });
});

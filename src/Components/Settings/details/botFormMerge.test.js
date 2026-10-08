import { keepLatest } from "./botFormMerge";

describe("keepLatest — a form only saves what it changed", () => {
  const opened = {
    id: "b1",
    name: "Reader",
    provider: "anthropic",
    subscriptions: [],
  };

  it("fields the form didn't change take the latest saved value", () => {
    // Since the form opened: the provider was changed elsewhere and a trigger
    // was added on the diagram. The form only renamed the bot.
    const latest = {
      id: "b1",
      name: "Reader",
      provider: "claude-code",
      subscriptions: [{ eventType: "e" }],
    };
    const edited = { ...opened, name: "Record Reader" };
    expect(keepLatest(edited, opened, latest)).toEqual({
      id: "b1",
      name: "Record Reader",
      provider: "claude-code",
      subscriptions: [{ eventType: "e" }],
    });
  });

  it("fields the form did change win, even over a newer value", () => {
    const latest = { ...opened, provider: "openai" };
    const edited = { ...opened, provider: "claude-code" };
    expect(keepLatest(edited, opened, latest).provider).toBe("claude-code");
  });

  it("no latest copy (new bot, or it can't be read) → the form's values", () => {
    const edited = { ...opened, name: "X" };
    expect(keepLatest(edited, opened, null)).toEqual(edited);
    expect(keepLatest(edited, null, opened)).toEqual(edited);
  });

  it("compares arrays and objects by value", () => {
    const latest = { ...opened, subscriptions: [{ eventType: "new" }] };
    const edited = { ...opened, subscriptions: [] }; // same as opened
    expect(keepLatest(edited, opened, latest).subscriptions).toEqual([
      { eventType: "new" },
    ]);
  });
});

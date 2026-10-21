import { stageOrApply, createPendingSettings } from "./pendingSettings";

describe("pending settings (notifications, schedule)", () => {
  test("while editing a change is staged, not applied", () => {
    const store = createPendingSettings();
    const apply = jest.fn();
    stageOrApply(store, "notif:w1:ready", apply);
    expect(apply).not.toHaveBeenCalled();
    expect(store.size()).toBe(1);
  });

  test("outside the editor it applies at once", () => {
    const apply = jest.fn();
    stageOrApply(null, "notif:w1:ready", apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test("the last change for a key wins; take() empties the store in order", () => {
    const counts = [];
    const store = createPendingSettings((n) => counts.push(n));
    const calls = [];
    store.stage("a", () => calls.push("a1"));
    store.stage("b", () => calls.push("b"));
    store.stage("a", () => calls.push("a2"));
    expect(store.size()).toBe(2);
    store.take().forEach((fn) => fn());
    expect(calls).toEqual(["a2", "b"]);
    expect(store.size()).toBe(0);
    expect(counts).toEqual([1, 2, 2, 0]);
  });

  test("clear() drops everything (Cancel)", () => {
    const store = createPendingSettings();
    const apply = jest.fn();
    store.stage("a", apply);
    store.clear();
    expect(store.take()).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });
});

test("unstage() drops a change undone before Save", () => {
  const counts = [];
  const store = createPendingSettings((n) => counts.push(n));
  store.stage("schedule:w1:refresh", () => {});
  store.unstage("schedule:w1:refresh");
  store.unstage("never-staged");
  expect(store.size()).toBe(0);
  expect(counts).toEqual([1, 0]);
});

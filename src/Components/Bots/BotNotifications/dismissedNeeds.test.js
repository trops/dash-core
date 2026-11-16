/**
 * dismissedNeeds — a dismissed card stays off until something newer happens.
 */
import {
  canDismiss,
  dismissKey,
  isDismissed,
  withDismissed,
} from "./dismissedNeeds";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 15, 12);
const plan = (at) => ({ id: "plan:q1", kind: "plan", at });
const failed = (at) => ({
  id: `failed:index:${at}`,
  kind: "failed",
  botId: "index",
  at,
});

test("plans and failed runs can be dismissed; asks can't", () => {
  expect(canDismiss(plan(NOW))).toBe(true);
  expect(canDismiss(failed(NOW))).toBe(true);
  expect(canDismiss({ id: "approval:a1", kind: "approval", at: NOW })).toBe(
    false,
  );
  expect(canDismiss(null)).toBe(false);
});

test("a bot's failures share one key, whenever they happened", () => {
  expect(dismissKey(failed(NOW - DAY))).toBe(dismissKey(failed(NOW)));
  expect(dismissKey(plan(NOW))).toBe("plan:q1");
});

test("dismissed until something newer: the plan ready again, the bot failing again", () => {
  const d = withDismissed({}, [plan(NOW - 1000), failed(NOW - 2000)], NOW);
  expect(isDismissed(plan(NOW - 1000), d)).toBe(true);
  expect(isDismissed(failed(NOW - 2000), d)).toBe(true);
  expect(isDismissed(plan(NOW), d)).toBe(false);
  expect(isDismissed(failed(NOW), d)).toBe(false);
  expect(isDismissed(plan(NOW), {})).toBe(false);
});

test("asks aren't added, and old dismissals are dropped", () => {
  const d = withDismissed(
    { "plan:old": NOW - 40 * DAY, "plan:recent": NOW - DAY },
    [{ id: "approval:a1", kind: "approval", at: NOW }],
    NOW,
  );
  expect(d).toEqual({ "plan:recent": NOW - DAY });
});

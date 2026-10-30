/**
 * draftAge (create-entry PRD CRE-005): a list's "5m ago".
 */
import { draftAge } from "./createRouting";

test("draftAge reads like a list timestamp", () => {
  const now = Date.UTC(2026, 9, 29, 12, 0, 0);
  expect(draftAge(now - 10_000, now)).toBe("just now");
  expect(draftAge(now - 5 * 60_000, now)).toBe("5m ago");
  expect(draftAge(now - 3 * 3600_000, now)).toBe("3h ago");
  expect(draftAge(now - 2 * 86400_000, now)).toBe("2d ago");
  expect(draftAge(now + 1000, now)).toBe("just now");
});

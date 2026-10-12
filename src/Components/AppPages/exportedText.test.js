/**
 * Export ZIP's status line (create-entry phase 5a): says how many bots went
 * along and what couldn't.
 */
import { exportedText } from "./exportedText";

test("bots and what wasn't included", () => {
  expect(exportedText({ success: true, bots: 0 })).toBe("Exported.");
  expect(exportedText({ success: true, bots: 1 })).toBe("Exported with 1 bot.");
  expect(
    exportedText({
      success: true,
      bots: 2,
      notIncluded: [
        'Greeter: the trigger "Z › go" (a widget on this dashboard)',
      ],
    }),
  ).toBe(
    'Exported with 2 bots. Not included: Greeter: the trigger "Z › go" (a widget on this dashboard).',
  );
  expect(exportedText({ success: false, error: "No space" })).toBe("No space");
  expect(exportedText(null)).toBe("Export failed.");
});

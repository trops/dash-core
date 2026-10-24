import { numberDuplicateLabels } from "./numberDuplicateLabels";

describe("numberDuplicateLabels", () => {
  test("two of a kind are numbered in order; a single one isn't", () => {
    const out = numberDuplicateLabels(
      [
        { id: "a", label: "Notepad" },
        { id: "b", label: "Clock" },
        { id: "c", label: "Notepad" },
      ],
      "label",
    );
    expect(out.map((r) => r.label)).toEqual([
      "Notepad 1",
      "Clock",
      "Notepad 2",
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("missing labels and non-arrays pass through", () => {
    const rows = [{ label: null }, { label: null }];
    expect(numberDuplicateLabels(rows, "label")).toEqual(rows);
    expect(numberDuplicateLabels(undefined, "label")).toBeUndefined();
  });
});

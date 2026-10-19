import { saveErrorText } from "./saveErrorText";

describe("saveErrorText", () => {
  it("says a permissions problem in plain words, without the file path", () => {
    const text = saveErrorText(
      new Error(
        "EACCES: permission denied, open '/Users/x/Library/Application Support/Dash/Dashboard/@trops/dash-electron/workspaces.json'",
      ),
    );
    expect(text).toBe("Dash isn't allowed to write to its data folder.");
    expect(text).not.toMatch(/workspaces\.json/);
  });

  it.each([
    [
      "EPERM: operation not permitted, rename 'a' -> 'b'",
      "Dash isn't allowed to write to its data folder.",
    ],
    ["ENOSPC: no space left on device, write", "The disk is full."],
    [
      "EROFS: read-only file system, open '/x'",
      "Dash's data folder is read-only.",
    ],
  ])("%s", (message, expected) => {
    expect(saveErrorText(new Error(message))).toBe(expected);
  });

  it("keeps any other message, and has a fallback", () => {
    expect(saveErrorText(new Error("No Api found"))).toBe("No Api found");
    expect(saveErrorText(null)).toBe("");
  });
});

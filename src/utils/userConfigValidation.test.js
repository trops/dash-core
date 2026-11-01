import {
  checkUrl,
  checkEmail,
  validateSetting,
  validateSettings,
  fixFirstText,
  unsavedText,
} from "./userConfigValidation";

describe("a URL setting", () => {
  test("web addresses pass", () => {
    expect(checkUrl("http://10.0.0.107").error).toBeNull();
    expect(checkUrl("https://ha.example.com:8123/").error).toBeNull();
    expect(checkUrl("").error).toBeNull();
  });
  test('"http//" (no colon) fails, with what it meant', () => {
    expect(checkUrl("http//10.0.0.107")).toEqual({
      error: "Not a web address. It should look like http://10.0.0.107",
      suggestion: "http://10.0.0.107",
    });
    expect(checkUrl("https//10.0.0.107").suggestion).toBe("https://10.0.0.107");
    expect(checkUrl("http:/10.0.0.107").suggestion).toBe("http://10.0.0.107");
  });
  test("no scheme: http for a home address, https otherwise", () => {
    expect(checkUrl("10.0.0.107").suggestion).toBe("http://10.0.0.107");
    expect(checkUrl("example.com").suggestion).toBe("https://example.com");
  });
  test("nothing like an address: no suggestion", () => {
    const r = checkUrl("not a url");
    expect(r.error).toMatch(/Not a web address/);
    expect(r.suggestion).toBeNull();
  });
});

describe("an email setting", () => {
  test("checks the shape", () => {
    expect(checkEmail("me@example.com").error).toBeNull();
    expect(checkEmail("me@example").error).toMatch(/Not an email address/);
  });
});

describe("any setting", () => {
  test("required is enforced, with its name", () => {
    expect(
      validateSetting({ displayName: "Player name", required: true }, "  ")
        .error,
    ).toBe("Player name is required.");
    expect(validateSetting({ required: false }, "").error).toBeNull();
  });
  test("numbers: limits say what they are, never eat keystrokes", () => {
    const item = { type: "number", min: 2, max: 60 };
    expect(validateSetting(item, 300).error).toBe("Must be between 2 and 60.");
    expect(validateSetting(item, "30").error).toBeNull();
    expect(validateSetting({ type: "number", min: 1 }, 0).error).toBe(
      "Must be at least 1.",
    );
    expect(
      validateSetting({ type: "number", displayName: "Rows" }, "abc").error,
    ).toBe("Rows has to be a number.");
  });
  test("length and pattern, with the widget's own message", () => {
    expect(validateSetting({ minLength: 3 }, "ab").error).toMatch(/at least 3/);
    expect(validateSetting({ maxLength: 2 }, "abc").error).toMatch(/at most 2/);
    expect(
      validateSetting(
        { pattern: "^[A-Z]{3}$", patternMessage: "Three capital letters." },
        "abc",
      ).error,
    ).toBe("Three capital letters.");
    expect(validateSetting({ pattern: "(" }, "anything").error).toBeNull();
  });
  test("the panel's list: only failures, in order", () => {
    const cfg = {
      haBaseUrl: { type: "url", displayName: "Home Assistant URL" },
      player: { type: "text", displayName: "Player", required: true },
      rows: { type: "number", min: 1 },
    };
    expect(
      Object.keys(
        validateSettings(cfg, {
          haBaseUrl: "http//10.0.0.107",
          player: "",
          rows: 3,
        }),
      ),
    ).toEqual(["haBaseUrl", "player"]);
    expect(validateSettings(cfg, { haBaseUrl: "http//x" }, ["rows"])).toEqual(
      {},
    );
  });
  test("words", () => {
    expect(fixFirstText(1)).toBe("Fix 1 setting first");
    expect(fixFirstText(2)).toBe("Fix 2 settings first");
    expect(unsavedText(1)).toBe("1 unsaved change");
    expect(unsavedText(3)).toBe("3 unsaved changes");
  });
});

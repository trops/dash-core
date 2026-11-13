import {
  modelName,
  runModelLabel,
  styleName,
  tookText,
  whyModel,
} from "./modelRunLabel";

describe("modelRunLabel — which model ran it, in words", () => {
  test("model ids read as family and version", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(modelName("claude-opus-4-20250514")).toBe("Opus 4");
    expect(modelName("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelName("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelName("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
    expect(modelName("gpt-x")).toBe("gpt-x");
    expect(modelName(null)).toBe(null);
  });

  test("model and style together", () => {
    expect(styleName("thorough")).toBe("Thorough");
    expect(styleName(null)).toBe(null);
    expect(runModelLabel({ model: "claude-opus-5-5", style: "thorough" })).toBe(
      "Opus 5.5 · Thorough",
    );
    expect(runModelLabel({ model: "claude-haiku-5-5" })).toBe("Haiku 5.5");
    expect(runModelLabel({ style: "normal" })).toBe("");
  });

  test("why that model: your choice in Settings › AI, or built in", () => {
    expect(whyModel("builder", true)).toBe(
      "Your choice for Create · Builder in Settings › AI",
    );
    expect(whyModel("checker", false)).toBe("Built in for the Checker");
    expect(whyModel("lead", true)).toBe(
      "Your choice for Dashboard leads in Settings › AI",
    );
    expect(whyModel("lead", false)).toBe("Built in for the dashboard's lead");
    expect(whyModel(null, false)).toBe("Built in");
  });

  test("how long it took", () => {
    expect(tookText(134000)).toBe("2 min 14 s");
    expect(tookText(9000)).toBe("9 s");
    expect(tookText(120000)).toBe("2 min");
    expect(tookText(0)).toBe(null);
  });
});

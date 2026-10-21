import { normalizeUserConfig } from "./userConfigFields";
import { ComponentConfigModel } from "../Models/ComponentConfigModel";
import { defaultProps } from "../Components/AppPages/WidgetPreview";
import { widgetFacts } from "../Components/Create/editCreate";

const LIST = [
  { key: "title", label: "Title", type: "text", defaultValue: "Counter" },
  { key: "step", label: "Step", type: "number", defaultValue: 1 },
];

describe("normalizeUserConfig", () => {
  test("an object stays as it is", () => {
    const uc = { title: { type: "text", displayName: "Title" } };
    expect(normalizeUserConfig(uc)).toBe(uc);
  });

  test("a list becomes the object keyed by setting name", () => {
    expect(normalizeUserConfig(LIST)).toEqual({
      title: {
        type: "text",
        defaultValue: "Counter",
        displayName: "Title",
      },
      step: { type: "number", defaultValue: 1, displayName: "Step" },
    });
  });

  test("name or id stand in for key; no label → the key", () => {
    const out = normalizeUserConfig([
      { name: "channel", type: "text" },
      { id: "limit", displayName: "Max rows", label: "ignored" },
    ]);
    expect(out.channel.displayName).toBe("channel");
    expect(out.limit.displayName).toBe("Max rows");
  });

  test("entries without a key, and junk, are dropped", () => {
    expect(normalizeUserConfig([{ label: "x" }, null, "a"])).toEqual({});
    expect(normalizeUserConfig(undefined)).toEqual({});
    expect(normalizeUserConfig("x")).toEqual({});
  });
});

describe("a widget whose settings are a list", () => {
  test("registers with them keyed by name (the Edit panel's form)", () => {
    const model = ComponentConfigModel({ name: "Counter", userConfig: LIST });
    expect(Object.keys(model.userConfig)).toEqual(["title", "step"]);
    expect(model.userConfig.step.displayName).toBe("Step");
  });

  test("previews with its defaults under their names", () => {
    expect(defaultProps({ userConfig: LIST })).toEqual({
      title: "Counter",
      step: 1,
    });
  });

  test("Describe shows this cell's values by name", () => {
    const facts = widgetFacts(
      { userConfig: LIST },
      { settings: { title: "Clicks", step: 5 } },
    );
    expect(facts.settings.join(" ")).toMatch(/Clicks/);
    expect(facts.settings.join(" ")).toMatch(/5/);
  });
});

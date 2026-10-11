import {
  getWidgetBuilderRenderer,
  setWidgetBuilderRenderer,
} from "./widgetBuilderRenderer";

describe("widgetBuilderRenderer", () => {
  afterEach(() => setWidgetBuilderRenderer(null));

  test("starts empty", () => {
    expect(getWidgetBuilderRenderer()).toBeNull();
  });

  test("keeps a function component", () => {
    const Builder = () => null;
    setWidgetBuilderRenderer(Builder);
    expect(getWidgetBuilderRenderer()).toBe(Builder);
  });

  test("keeps a memo/forwardRef object component", () => {
    const Memo = { $$typeof: Symbol.for("react.memo"), type: () => null };
    setWidgetBuilderRenderer(Memo);
    expect(getWidgetBuilderRenderer()).toBe(Memo);
  });

  test("anything else clears it", () => {
    setWidgetBuilderRenderer(() => null);
    setWidgetBuilderRenderer("nope");
    expect(getWidgetBuilderRenderer()).toBeNull();
  });
});

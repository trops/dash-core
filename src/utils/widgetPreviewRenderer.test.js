import {
  setWidgetPreviewRenderer,
  getWidgetPreviewRenderer,
} from "./widgetPreviewRenderer";

afterEach(() => setWidgetPreviewRenderer(null));

describe("widgetPreviewRenderer — the host's live widget preview (NAV-011)", () => {
  it("is empty until the host registers one", () => {
    expect(getWidgetPreviewRenderer()).toBeNull();
  });

  it("returns what the host registered", () => {
    const Renderer = () => null;
    setWidgetPreviewRenderer(Renderer);
    expect(getWidgetPreviewRenderer()).toBe(Renderer);
  });

  it("ignores anything that isn't a component", () => {
    setWidgetPreviewRenderer("nope");
    expect(getWidgetPreviewRenderer()).toBeNull();
  });
});

/**
 * WidgetHelpers.publishEvent — stamps the widget's dashboard on every event so
 * bots subscribed to one dashboard's widget don't fire for a copy of it
 * (copied dashboards reuse widget ids).
 */
import { WidgetHelpers } from "./WidgetHelpers";

describe("WidgetHelpers.publishEvent", () => {
  it("publishes Component[id].event with the widget's dashboard", () => {
    const api = { publishEvent: jest.fn() };
    const helpers = new WidgetHelpers(
      { component: "EventSender", id: 11, dashboardId: 7 },
      api,
    );
    helpers.publishEvent("buttonClicked", { n: 1 });
    expect(api.publishEvent).toHaveBeenCalledWith(
      "EventSender[11].buttonClicked",
      { n: 1 },
      null,
      { workspaceId: 7 },
    );
  });
});

describe("WidgetApi.publishEvent", () => {
  const { WidgetApi } = require("./WidgetApi");

  it("passes the dashboard meta through to the publisher", () => {
    const pub = { pub: jest.fn() };
    WidgetApi.setPublisher(pub);
    WidgetApi.publishEvent("EventSender[11].buttonClicked", { n: 1 }, null, {
      workspaceId: 7,
    });
    expect(pub.pub).toHaveBeenCalledWith(
      "EventSender[11].buttonClicked",
      { n: 1 },
      { workspaceId: 7 },
    );
  });
});

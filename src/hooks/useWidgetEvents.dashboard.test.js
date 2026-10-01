/**
 * useWidgetEvents.publishEvent stamps the widget's dashboard on every event
 * (copied dashboards reuse widget ids — see eventMatcher's per-subscription
 * dashboard check).
 */
import React from "react";
import { renderHook } from "@testing-library/react";
import { useWidgetEvents } from "./useWidgetEvents";
import { DashboardContext } from "../Context/DashboardContext";
import { WidgetContext } from "../Context/WidgetContext";

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  console.log.mockRestore();
});

it("publishes Component[id].event with the widget's dashboard", () => {
  const pub = jest.fn();
  const wrapper = ({ children }) => (
    <DashboardContext.Provider value={{ pub: { pub } }}>
      <WidgetContext.Provider
        value={{
          widgetData: {
            componentName: "EventSender",
            id: 11,
            uuid: "u1",
            dashboardId: 7,
          },
        }}
      >
        {children}
      </WidgetContext.Provider>
    </DashboardContext.Provider>
  );
  const { result } = renderHook(() => useWidgetEvents(), { wrapper });
  result.current.publishEvent("buttonClicked", { n: 1 });
  expect(pub).toHaveBeenCalledWith(
    "EventSender[11].buttonClicked",
    { n: 1 },
    { workspaceId: 7 },
  );
});

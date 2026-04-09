import { createContext } from "react";
import { DashboardPublisher } from "../DashboardPublisher";
import { WidgetApi } from "../Api";
import { DashboardActionsApi } from "../Api/DashboardActionsApi";

function buildWidgetApi() {
  console.log(DashboardPublisher);
  const w = WidgetApi;
  w.setPublisher(DashboardPublisher);
  return w;
}

export const DashboardContext = createContext({
  pub: DashboardPublisher,
  widgetApi: buildWidgetApi(),
  dashApi: null,
  dashboardApi: DashboardActionsApi,
  providers: {},
});

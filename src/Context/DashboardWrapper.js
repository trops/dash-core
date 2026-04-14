import { DashboardContext } from "./DashboardContext";
import { DashboardPublisher } from "../DashboardPublisher";
import { WidgetApi } from "../Api";
import { DashboardActionsApi } from "../Api/DashboardActionsApi";
import { AppWrapper } from "./App/AppWrapper";
import { ThemeWrapper } from "./ThemeWrapper";
import { MainSection } from "@trops/dash-react";
import { useContext, useEffect, useMemo } from "react";
import { AppContext } from "./App/AppContext";

const EMPTY_PROVIDERS = {};

export const DashboardWrapper = ({
  dashApi,
  credentials,
  backgroundColor = null,
  children,
}) => {
  // use the contexts to pass through any information
  const appContext = useContext(AppContext);

  const widgetApi = useMemo(() => {
    const w = WidgetApi;
    w.setPublisher(DashboardPublisher);
    w.setElectronApi(dashApi);
    return w;
  }, [dashApi]);

  useEffect(() => {
    // Only popout windows replay cached events on subscribe — keeps the
    // main dashboard from resurrecting stale state when reopened while
    // still letting popped-out widgets hydrate from current state.
    // Electron uses hash routing, so the popout path lives in
    // window.location.hash (e.g. "#/popout-widget/..."), not pathname.
    const isPopout =
      typeof window !== "undefined" &&
      ((typeof window.location?.hash === "string" &&
        window.location.hash.includes("/popout")) ||
        (typeof window.location?.pathname === "string" &&
          window.location.pathname.includes("/popout")));
    DashboardPublisher.enableIpcBridge({ replay: isPopout });
    return () => DashboardPublisher.disableIpcBridge();
  }, []);

  const providers = appContext?.providers || EMPTY_PROVIDERS;

  const contextValue = useMemo(
    () => ({
      widgetApi,
      pub: DashboardPublisher,
      dashApi,
      dashboardApi: DashboardActionsApi,
      credentials,
      providers,
    }),
    [widgetApi, dashApi, credentials, providers],
  );

  return (
    <AppWrapper dashApi={dashApi} credentials={credentials}>
      <ThemeWrapper dashApi={dashApi} credentials={credentials}>
        <div className="flex flex-col w-screen h-screen overflow-clip justify-between p-0">
          <MainSection backgroundColor={backgroundColor}>
            <DashboardContext.Provider value={contextValue}>
              {children}
            </DashboardContext.Provider>
          </MainSection>
        </div>
      </ThemeWrapper>
    </AppWrapper>
  );
};

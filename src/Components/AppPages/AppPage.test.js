/**
 * AppPage — the full-screen host for a Manage page (app-navigation NAV-003).
 * Slice 1 reuses the Settings section components; these are mocked so the
 * test pins the wiring: which section renders, its props, the page's
 * primary action and provider deep links.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

// A function declaration (hoisted) — jest.mock factories run before consts.
function mockSection(name) {
  return function MockSection(props) {
    return renderMock(name, props);
  };
}
const renderMock = (name, props) => (
  <div data-testid={`section-${name}`}>
    <span data-testid="create">{String(!!props.createRequested)}</span>
    <button
      onClick={() => props.onCreateAcknowledged && props.onCreateAcknowledged()}
    >
      ack
    </button>
    {props.initialProviderName ? (
      <span data-testid="provider">{props.initialProviderName}</span>
    ) : null}
    {props.initialCreateRequested ? (
      <span data-testid="provider-create" />
    ) : null}
    {props.initialProviderType ? (
      <span data-testid="provider-type">{props.initialProviderType}</span>
    ) : null}
    {props.onOpenThemeEditor ? (
      <button onClick={props.onOpenThemeEditor}>edit theme</button>
    ) : null}
    {props.onOpenWorkspace ? (
      <button onClick={() => props.onOpenWorkspace({ id: 1 })}>open ws</button>
    ) : null}
    {props.onOpenBotsView ? (
      <button onClick={() => props.onOpenBotsView({ id: 1 })}>bots view</button>
    ) : null}
    {props.onOpenDashboardConfig ? (
      <button onClick={() => props.onOpenDashboardConfig({ id: 1 })}>
        dashboard config
      </button>
    ) : null}
  </div>
);

// Slice 2: the Dashboards page (list + detail) replaced DashboardsSection.
jest.mock("./DashboardsPage", () => ({
  DashboardsPage: mockSection("dashboards"),
}));
jest.mock("../Settings/sections/FoldersSection", () => ({
  FoldersSection: mockSection("folders"),
}));
jest.mock("../Settings/sections/BotsSection", () => ({
  BotsSection: mockSection("bots"),
}));
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: mockSection("providers"),
}));
jest.mock("../Settings/sections/WidgetsSection", () => ({
  WidgetsSection: mockSection("widgets"),
}));
jest.mock("../Settings/sections/ThemesSection", () => ({
  ThemesSection: mockSection("themes"),
}));

import { AppPage } from "./AppPage";
import { ThemeContext } from "@trops/dash-react";

describe("AppPage", () => {
  it("shows the page header and its section", () => {
    render(<AppPage pageKey="bots" />);
    expect(screen.getByText("Manage")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bots" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Every bot, grouped by the dashboard team it works for.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("section-bots")).toBeInTheDocument();
  });

  it.each([
    ["bots", "New Bot"],
    ["providers", "New Provider"],
    ["widgets", "New Widget"],
    ["themes", "New Theme"],
    ["dashboards", "New Dashboard"],
  ])("%s: the primary action asks the section to create", (key, label) => {
    render(<AppPage pageKey={key} />);
    expect(screen.getByTestId("create")).toHaveTextContent("false");
    fireEvent.click(screen.getByText(label));
    expect(screen.getByTestId("create")).toHaveTextContent("true");
    fireEvent.click(screen.getByText("ack"));
    expect(screen.getByTestId("create")).toHaveTextContent("false");
  });

  it("Dashboards switches between Dashboards and Folders", () => {
    render(<AppPage pageKey="dashboards" />);
    expect(screen.getByTestId("section-dashboards")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Folders" }));
    expect(screen.getByTestId("section-folders")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
  });

  it("opens on Folders when asked (Settings › Folders links)", () => {
    render(<AppPage pageKey="dashboards" subsection="folders" />);
    expect(screen.getByTestId("section-folders")).toBeInTheDocument();
  });

  it("passes provider deep links to Providers", () => {
    render(
      <AppPage
        pageKey="providers"
        providerLink={{
          name: "Gmail 3",
          create: true,
          type: "gmail",
          providerClass: null,
          nonce: 1,
        }}
      />,
    );
    expect(screen.getByTestId("provider")).toHaveTextContent("Gmail 3");
    expect(screen.getByTestId("provider-create")).toBeInTheDocument();
    expect(screen.getByTestId("provider-type")).toHaveTextContent("gmail");
  });

  it("passes the theme editor and open-dashboard callbacks through", () => {
    const onOpenThemeEditor = jest.fn();
    const onOpenWorkspace = jest.fn();
    const { unmount } = render(
      <AppPage pageKey="themes" onOpenThemeEditor={onOpenThemeEditor} />,
    );
    fireEvent.click(screen.getByText("edit theme"));
    expect(onOpenThemeEditor).toHaveBeenCalled();
    unmount();
    const onOpenBotsView = jest.fn();
    const onOpenDashboardConfig = jest.fn();
    render(
      <AppPage
        pageKey="dashboards"
        onOpenWorkspace={onOpenWorkspace}
        onOpenBotsView={onOpenBotsView}
        onOpenDashboardConfig={onOpenDashboardConfig}
      />,
    );
    fireEvent.click(screen.getByText("open ws"));
    expect(onOpenWorkspace).toHaveBeenCalledWith({ id: 1 });
    fireEvent.click(screen.getByText("bots view"));
    expect(onOpenBotsView).toHaveBeenCalledWith({ id: 1 });
    fireEvent.click(screen.getByText("dashboard config"));
    expect(onOpenDashboardConfig).toHaveBeenCalledWith({ id: 1 });
  });

  it("renders nothing for an unknown page", () => {
    const { container } = render(<AppPage pageKey="nope" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the title uses the theme's strong text colour (readable on the app theme)", () => {
    render(
      <ThemeContext.Provider
        value={{ currentTheme: { "text-neutral-light": "tok-strong" } }}
      >
        <AppPage pageKey="themes" />
      </ThemeContext.Provider>,
    );
    expect(screen.getByRole("heading", { name: "Themes" })).toHaveClass(
      "tok-strong",
    );
  });

  it("the selected Dashboards/Folders tab is readable too", () => {
    render(
      <ThemeContext.Provider
        value={{
          currentTheme: {
            "text-neutral-light": "tok-strong",
            "text-neutral-medium": "tok-muted",
          },
        }}
      >
        <AppPage pageKey="dashboards" />
      </ThemeContext.Provider>,
    );
    expect(screen.getByRole("tab", { name: "Dashboards" })).toHaveClass(
      "tok-strong",
    );
    expect(screen.getByRole("tab", { name: "Folders" })).toHaveClass(
      "tok-muted",
    );
  });
});

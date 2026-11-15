/**
 * @jest-environment jsdom
 *
 * DashSidebar — folders in the left nav (app-navigation PRD NAV-017): each
 * folder one folded line with its icon and count; the arrow opens it in
 * place (remembered); the name opens the Dashboards page on it. Collapsed,
 * the Dashboards icon opens a menu with Recents, folders, Find and All
 * dashboards.
 */
import React from "react";
import { render, fireEvent, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

let mockCollapsed = false;

jest.mock(
  "@headlessui/react",
  () => {
    const React = require("react");
    const Popover = ({ children }) =>
      (typeof children === "function" ? children : () => children)({
        open: false,
        close: () => {},
      });
    Popover.Button = React.forwardRef(({ children, ...rest }, ref) => (
      <button ref={ref} {...rest}>
        {children}
      </button>
    ));
    Popover.Panel = () => null;
    return { Popover, Transition: () => null };
  },
  { virtual: true },
);

jest.mock("@trops/dash-react", () => {
  const React = require("react");
  const Sidebar = ({ children }) => <aside>{children}</aside>;
  Sidebar.Header = ({ children }) => <div>{children}</div>;
  Sidebar.Content = ({ children }) => <div>{children}</div>;
  Sidebar.Footer = ({ children }) => <div>{children}</div>;
  Sidebar.Trigger = () => <button>collapse</button>;
  // Mirrors dash-react: the icon always renders; label + badge only when
  // expanded; a collapsed item's label becomes its title.
  Sidebar.Item = ({ children, onClick, icon, active, badge }) => (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? "true" : "false"}
      title={
        mockCollapsed && typeof children === "string" ? children : undefined
      }
    >
      {icon}
      {!mockCollapsed && <span>{children}</span>}
      {!mockCollapsed && badge}
    </button>
  );
  Sidebar.Group = ({ children, label }) => (
    <section aria-label={label || undefined}>
      {!mockCollapsed && label ? <h4>{label}</h4> : null}
      {children}
    </section>
  );
  return {
    Sidebar,
    FontAwesomeIcon: ({ icon }) => <span data-icon={icon} />,
    ThemeContext: React.createContext({
      themeVariant: "dark",
      changeThemeVariant: () => {},
      currentTheme: {},
    }),
    useSidebar: () => ({ collapsed: mockCollapsed }),
    // The account menu: themed dropdown colors, ListRow rows, and the
    // profile-switch confirm.
    getStylesForItem: () => ({}),
    themeObjects: {},
    ListRow: ({ title, icon, onClick, selected, trailing }) => (
      <button onClick={onClick} aria-current={selected ? "true" : undefined}>
        {typeof icon === "string" ? null : icon}
        <span>{title}</span>
        {trailing}
      </button>
    ),
    ConfirmationModal: () => null,
    // ListGroupLabel reads the role tokens.
    DASH_ROLES: new Proxy(
      {},
      { get: (t, k) => ({ key: k, role: `dr-role-${String(k)}` }) },
    ),
    ButtonIcon3: ({ ariaLabel, onClick }) => (
      <button aria-label={ariaLabel} onClick={onClick} />
    ),
    SearchInput: ({ value, onChange, placeholder }) => (
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
    useStatusTokens: () => {
      const make = (c) => ({
        text: `text-${c}-200`,
        icon: `text-${c}-400`,
        solidBg: `bg-${c}-500`,
      });
      return { error: make("red"), warning: make("amber") };
    },
  };
});

jest.mock("react-dom", () => {
  const actual = jest.requireActual("react-dom");
  return { ...actual, createPortal: (children) => children };
});

import { DashSidebar } from "./DashSidebar";

const baseProps = {
  collapsed: false,
  onCollapsedChange: jest.fn(),
  workspaces: [],
  menuItems: [],
  activeTabId: null,
  recentDashboards: [],
  authStatus: "authenticated",
  authProfile: { displayName: "John" },
  onOpenWorkspace: jest.fn(),
  onNewDashboard: jest.fn(),
  onOpenSettings: jest.fn(),
  onOpenCommandPalette: jest.fn(),
  onSignIn: jest.fn(),
  onSignOut: jest.fn(),
};

function setup(props = {}, { collapsed = false } = {}) {
  mockCollapsed = collapsed;
  const onOpenPage = jest.fn();
  render(
    <DashSidebar
      {...baseProps}
      collapsed={collapsed}
      onOpenPage={onOpenPage}
      {...props}
    />,
  );
  return { onOpenPage };
}

const folders = [
  { id: 1772547938413, name: "Comms", icon: "envelope" },
  { id: 1777165825716, name: "Sink Testing" },
  { id: 5, name: "Algolia Experiments", icon: "magnifying-glass" },
];
const workspaces = [
  {
    id: 1,
    name: "Slack test",
    menuId: 1772547938413,
    updatedAt: "2026-10-13T00:00:00Z",
  },
  {
    id: 2,
    name: "Test Widget AI",
    menuId: 1772547938413,
    updatedAt: "2026-10-31T00:00:00Z",
  },
  { id: 3, name: "Kitchen Sink", menuId: "1777165825716" },
  { id: 4, name: "Smart Home", menuId: 1, updatedAt: "2026-11-14T00:00:00Z" },
];
const props = {
  workspaces,
  menuItems: folders,
  recentDashboards: [{ workspaceId: 4, name: "Smart Home" }],
};
const group = () => screen.getByRole("region", { name: "Folders" });

beforeEach(() => window.localStorage.clear());

describe("DashSidebar — folders, expanded", () => {
  it("each folder is one folded line A–Z with its count; empty ones too; then Not in a folder", () => {
    setup(props);
    const rows = [
      "Algolia Experiments",
      "Comms",
      "Sink Testing",
      "Not in a folder",
    ];
    const shown = within(group())
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t);
    expect(shown).toEqual([
      "Algolia Experiments0",
      "Comms2",
      "Sink Testing1",
      "Not in a folder1",
    ]);
    expect(rows).toHaveLength(4);
    // Folded: no dashboards listed.
    expect(within(group()).queryByText("Slack test")).toBeNull();
  });

  it("the arrow opens a folder in place, newest first, and it stays open", () => {
    setup(props);
    fireEvent.click(
      screen.getByRole("button", { name: "Show dashboards in Comms" }),
    );
    const comms = screen.getByTestId("nav-folder-1772547938413");
    const names = within(comms)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t && t !== "Comms2");
    expect(names).toEqual(["Test Widget AI", "Slack test"]);
    expect(
      JSON.parse(window.localStorage.getItem("dash.nav.openFolders")),
    ).toEqual(["1772547938413"]);
    fireEvent.click(within(comms).getByText("Slack test"));
    expect(baseProps.onOpenWorkspace).toHaveBeenCalledWith(workspaces[0]);
  });

  it("remembers open folders from before", () => {
    window.localStorage.setItem(
      "dash.nav.openFolders",
      JSON.stringify(["1777165825716"]),
    );
    setup(props);
    expect(within(group()).getByText("Kitchen Sink")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide dashboards in Sink Testing" }),
    ).toBeInTheDocument();
  });

  it("a folder's name opens the Dashboards page on it", () => {
    const onOpenFolder = jest.fn();
    setup({ ...props, onOpenFolder });
    fireEvent.click(within(group()).getByText("Comms"));
    expect(onOpenFolder).toHaveBeenCalledWith("1772547938413");
    fireEvent.click(within(group()).getByText("Not in a folder"));
    expect(onOpenFolder).toHaveBeenCalledWith("none");
  });

  it("no folders and every dashboard in one: no Folders group", () => {
    setup({ workspaces: [], menuItems: [] });
    expect(screen.queryByRole("region", { name: "Folders" })).toBeNull();
  });
});

describe("DashSidebar — collapsed: the Dashboards menu", () => {
  it("the Dashboards icon opens the menu instead of the page", () => {
    const { onOpenPage } = setup(props, { collapsed: true });
    fireEvent.click(screen.getByTitle("Dashboards"));
    expect(onOpenPage).not.toHaveBeenCalled();
    const menu = screen.getByTestId("nav-dashboards-menu");
    expect(menu).toHaveTextContent("Recents");
    expect(within(menu).getByText("Smart Home")).toBeInTheDocument();
    expect(within(menu).getByText("Comms")).toBeInTheDocument();
    expect(within(menu).getByText("Not in a folder")).toBeInTheDocument();
  });

  it("a folder opens in place; picking a dashboard opens it and closes the menu", () => {
    setup(props, { collapsed: true });
    fireEvent.click(screen.getByTitle("Dashboards"));
    let menu = screen.getByTestId("nav-dashboards-menu");
    expect(within(menu).queryByText("Slack test")).toBeNull();
    fireEvent.click(within(menu).getByText("Comms"));
    menu = screen.getByTestId("nav-dashboards-menu");
    fireEvent.click(within(menu).getByText("Slack test"));
    expect(baseProps.onOpenWorkspace).toHaveBeenCalledWith(workspaces[0]);
    expect(screen.queryByTestId("nav-dashboards-menu")).toBeNull();
  });

  it("Find filters every dashboard by name, with its folder", () => {
    setup(props, { collapsed: true });
    fireEvent.click(screen.getByTitle("Dashboards"));
    fireEvent.change(screen.getByLabelText("Find a dashboard…"), {
      target: { value: "kitchen" },
    });
    const menu = screen.getByTestId("nav-dashboards-menu");
    expect(within(menu).getByText("Kitchen Sink")).toBeInTheDocument();
    expect(within(menu).queryByText("Comms")).toBeNull();
  });

  it("All dashboards opens the page on All dashboards; Escape closes the menu", () => {
    const onOpenFolder = jest.fn();
    setup({ ...props, onOpenFolder }, { collapsed: true });
    fireEvent.click(screen.getByTitle("Dashboards"));
    fireEvent.click(
      within(screen.getByTestId("nav-dashboards-menu")).getByText(
        "All dashboards",
      ),
    );
    expect(onOpenFolder).toHaveBeenCalledWith("all");
    fireEvent.click(screen.getByTitle("Dashboards"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("nav-dashboards-menu")).toBeNull();
  });
});

describe("DashSidebar — one open-folders state", () => {
  it("a folder opened in the collapsed menu shows open when the nav expands", () => {
    mockCollapsed = true;
    const view = render(
      <DashSidebar
        {...baseProps}
        {...props}
        collapsed
        onOpenPage={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle("Dashboards"));
    fireEvent.click(
      within(screen.getByTestId("nav-dashboards-menu")).getByText("Comms"),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    mockCollapsed = false;
    view.rerender(
      <DashSidebar
        {...baseProps}
        {...props}
        collapsed={false}
        onOpenPage={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Hide dashboards in Comms" }),
    ).toBeInTheDocument();
  });

  it("opening the menu puts focus in Find", () => {
    setup(props, { collapsed: true });
    fireEvent.click(screen.getByTitle("Dashboards"));
    expect(document.activeElement).toBe(
      screen.getByLabelText("Find a dashboard…"),
    );
  });
});

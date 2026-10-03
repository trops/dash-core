/**
 * @jest-environment jsdom
 *
 * DashSidebar — the Manage group (app-navigation PRD NAV-001): Dashboards,
 * Bots, Providers, Widgets, Themes; visible when collapsed; the active page
 * is marked; Bots shows how many approvals are waiting.
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

const manage = () => screen.getByRole("region", { name: "Manage" });

describe("DashSidebar — Manage group", () => {
  it("lists Dashboards, Bots, Providers, Widgets, Themes and opens a page", () => {
    const { onOpenPage } = setup();
    const items = within(manage()).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual([
      "Dashboards",
      "Bots",
      "Providers",
      "Widgets",
      "Themes",
    ]);
    fireEvent.click(within(manage()).getByText("Providers"));
    expect(onOpenPage).toHaveBeenCalledWith("providers");
  });

  it("marks the open page as active", () => {
    setup({ activePageKey: "bots" });
    const bots = within(manage()).getByText("Bots").closest("button");
    expect(bots).toHaveAttribute("data-active", "true");
    const themes = within(manage()).getByText("Themes").closest("button");
    expect(themes).toHaveAttribute("data-active", "false");
  });

  it("shows how many bot approvals are waiting", () => {
    setup({ pageAttention: { bots: 2 } });
    const bots = within(manage()).getByText("Bots").closest("button");
    expect(within(bots).getByTestId("nav-attention-dot")).toBeInTheDocument();
    expect(within(bots).getByText("2")).toBeInTheDocument();
    const providers = within(manage()).getByText("Providers").closest("button");
    expect(within(providers).queryByTestId("nav-attention-dot")).toBeNull();
  });

  it("collapsed: every Manage page stays as an icon (with its dot)", () => {
    const { onOpenPage } = setup(
      { pageAttention: { bots: 1 } },
      { collapsed: true },
    );
    for (const label of [
      "Dashboards",
      "Bots",
      "Providers",
      "Widgets",
      "Themes",
    ]) {
      expect(screen.getByTitle(label)).toBeInTheDocument();
    }
    expect(
      within(screen.getByTitle("Bots")).getByTestId("nav-attention-dot"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Themes"));
    expect(onOpenPage).toHaveBeenCalledWith("themes");
  });
});

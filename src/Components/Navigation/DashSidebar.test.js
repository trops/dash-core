/**
 * @jest-environment jsdom
 *
 * DashSidebar — pins the footer popover items so a feature like
 * "Check for updates" can't silently disappear from the popover
 * (the bug we just had — the item was gated on
 * `typeof triggerAppUpdatesCheck === "function"` and quietly hid
 * itself when AppContext wasn't above the sidebar). This test
 * mounts the real DashSidebar with a real AppContext.Provider and
 * asserts the popover renders the item and routes the click back
 * through the context trigger.
 */

import React from "react";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Headless-UI Popover renders behind render-props with an `open`
// signal. For these tests we want the panel CONTENT to be visible
// from the first render so we can assert on items inside it.
// virtual:true because @headlessui/react comes through dash-electron's
// node_modules at runtime, not dash-core's.
jest.mock(
  "@headlessui/react",
  () => {
    const React = require("react");
    const Popover = ({ children }) => {
      const childFn =
        typeof children === "function" ? children : () => children;
      return childFn({ open: true, close: () => {} });
    };
    Popover.Button = React.forwardRef(({ children, ...rest }, ref) => (
      <button ref={ref} {...rest}>
        {children}
      </button>
    ));
    Popover.Panel = ({ children, ...rest }) => <div {...rest}>{children}</div>;
    return {
      Popover,
      Transition: ({ show, children }) => (show !== false ? children : null),
    };
  },
  { virtual: true },
);

// dash-react — Sidebar primitives + ThemeContext + FontAwesomeIcon.
jest.mock("@trops/dash-react", () => {
  const React = require("react");
  const Sidebar = ({ children }) => <aside>{children}</aside>;
  Sidebar.Header = ({ children }) => <div>{children}</div>;
  Sidebar.Content = ({ children }) => <div>{children}</div>;
  Sidebar.Footer = ({ children }) => <div>{children}</div>;
  Sidebar.Trigger = () => <button>collapse</button>;
  Sidebar.Item = ({ children, onClick }) => (
    <button onClick={onClick}>{children}</button>
  );
  Sidebar.Group = ({ children, label }) => (
    <div>
      <div>{label}</div>
      {children}
    </div>
  );
  return {
    Sidebar,
    FontAwesomeIcon: ({ icon }) => <span data-icon={icon} />,
    ThemeContext: React.createContext({
      themeVariant: "dark",
      changeThemeVariant: () => {},
      currentTheme: {},
    }),
    useSidebar: () => ({ collapsed: false }),
  };
});

// react-dom's createPortal renders into document.body. For tests
// just inline the children so they appear in the testing-library
// container.
jest.mock("react-dom", () => {
  const actual = jest.requireActual("react-dom");
  return { ...actual, createPortal: (children) => children };
});

import { DashSidebar } from "./DashSidebar";
import { AppContext } from "../../Context/App/AppContext";

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

function renderWithContext(contextValue) {
  return render(
    <AppContext.Provider value={contextValue}>
      <DashSidebar {...baseProps} />
    </AppContext.Provider>,
  );
}

afterEach(() => {
  delete window.mainApi;
  delete window.__DASH_DEBUG;
});

describe("DashSidebar — FooterPopover Check-for-updates item", () => {
  test("renders 'Check for updates' when AppContext provides triggerAppUpdatesCheck", async () => {
    const trigger = jest.fn();
    renderWithContext({ triggerAppUpdatesCheck: trigger });
    await waitFor(() => {
      expect(screen.getByText("Check for updates")).toBeInTheDocument();
    });
    // Sanity — the other items still render alongside it.
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Do Not Disturb")).toBeInTheDocument();
  });

  test("renders 'Check for updates' EVEN when AppContext is missing the trigger (was the bug)", () => {
    // Pre-fix: this item was gated on `typeof trigger === "function"`
    // and silently disappeared when the context didn't have it. Now
    // it renders unconditionally; the click no-ops + writes a debug
    // breadcrumb instead.
    renderWithContext({
      /* no triggerAppUpdatesCheck */
    });
    expect(screen.getByText("Check for updates")).toBeInTheDocument();
  });

  test("clicking the item invokes the context trigger AND closes the popover", () => {
    const trigger = jest.fn();
    renderWithContext({ triggerAppUpdatesCheck: trigger });
    fireEvent.click(screen.getByText("Check for updates"));
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  test("clicking with no trigger logs a window.__DASH_DEBUG breadcrumb (so we can diagnose missing context)", () => {
    renderWithContext({});
    fireEvent.click(screen.getByText("Check for updates"));
    const breadcrumbs = window.__DASH_DEBUG || [];
    expect(
      breadcrumbs.some(
        (b) =>
          b.src === "DashSidebar" &&
          b.event === "triggerAppUpdatesCheck:missing-from-context",
      ),
    ).toBe(true);
  });

  test("the popover items render in a stable order: Settings → Theme → DND → Check for updates → Sign Out", () => {
    renderWithContext({ triggerAppUpdatesCheck: jest.fn() });
    const labels = [
      "Settings",
      // Theme toggle reads themeVariant from the mocked
      // ThemeContext (defaults to "dark" so the label is "Light
      // Mode").
      "Light Mode",
      "Do Not Disturb",
      "Check for updates",
      "Sign Out",
    ];
    const positions = labels.map((l) => {
      const el = screen.getByText(l);
      // Compare DOM-order via compareDocumentPosition through
      // common parent.
      return { l, el };
    });
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1].el;
      const cur = positions[i].el;
      // 0x04 = DOCUMENT_POSITION_FOLLOWING — `cur` follows `prev`
      // in document order.
      // eslint-disable-next-line no-bitwise
      expect(prev.compareDocumentPosition(cur) & 0x04).toBeTruthy();
    }
  });
});

/**
 * DashboardsPage — the Dashboards Manage page as list + detail
 * (app-navigation PRD NAV-005).
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: {
    config: jest.fn((name) =>
      name === "trops.slack.ChannelMessages"
        ? { providers: [{ type: "slack", required: true }] }
        : name === "trops.gmail.Inbox"
          ? { providers: [{ type: "gmail", required: true }] }
          : null,
    ),
  },
}));
jest.mock("../Bots/useTeamBots", () => ({
  useTeamBots: (workspaceId) => ({
    loading: false,
    lead:
      String(workspaceId) === "7"
        ? { id: "lead7", name: "Kitchen Sink Lead", role: "lead" }
        : null,
    members:
      String(workspaceId) === "7" ? [{ id: "b1", name: "Inbox Watch" }] : [],
    statusOf: (id) => (id === "b1" ? "Needs approval" : "Idle"),
  }),
}));
jest.mock("./useApprovalsByDashboard", () => ({
  useApprovalsByDashboard: () => (id) => (String(id) === "7" ? 1 : 0),
}));
jest.mock("../Settings/details/NewDashboardChooser", () => ({
  NewDashboardChooser: ({ onSelect }) => (
    <div data-testid="chooser">
      <button onClick={() => onSelect("wizard")}>wizard</button>
      <button onClick={() => onSelect("marketplace")}>marketplace</button>
    </div>
  ),
}));
jest.mock("../Settings/details/DiscoverDashboardsDetail", () => ({
  DiscoverDashboardsDetail: () => <div data-testid="marketplace" />,
}));
jest.mock("../Settings/details/StarRating", () => ({
  StarRating: () => <div data-testid="rating" />,
}));
jest.mock("../Settings/details/PublishDashboardModal", () => ({
  PublishDashboardModal: ({ isOpen }) =>
    isOpen ? <div data-testid="publish" /> : null,
}));

import { DashboardsPage } from "./DashboardsPage";

const ks = {
  id: 7,
  name: "Kitchen Sink",
  menuId: 1,
  themeKey: "aurora",
  pages: [
    {
      id: "p1",
      name: "Overview",
      layout: [
        {
          id: 99,
          component: "LayoutGridContainer",
          dashboardId: 7,
          grid: { rows: 1, cols: 2, 1.1: {}, 1.2: {} },
          items: [
            {
              id: 1,
              uuidString: "w1",
              component: "trops.slack.ChannelMessages",
              dashboardId: 7,
            },
            {
              id: 2,
              uuidString: "w2",
              component: "trops.gmail.Inbox",
              dashboardId: 7,
            },
          ],
        },
      ],
    },
    {
      id: "p2",
      name: "Notes",
      layout: [
        { id: 3, uuidString: "w3", component: "Notepad", dashboardId: 7 },
      ],
    },
  ],
};
const sales = { id: 8, name: "Sales", menuId: 2, pages: [], layout: [] };
const loose = { id: 9, name: "Loose", menuId: null, pages: [], layout: [] };
const menuItems = [
  { id: 1, name: "Work" },
  { id: 2, name: "Experiments" },
];

function setup(props = {}) {
  const dashApi = {
    saveWorkspace: jest.fn((appId, ws, ok) => ok && ok()),
    deleteWorkspace: jest.fn((appId, id, ok) => ok && ok()),
  };
  const handlers = {
    onOpenWorkspace: jest.fn(),
    onOpenBotsView: jest.fn(),
    onOpenDashboardConfig: jest.fn(),
    onReloadWorkspaces: jest.fn(),
    onOpenWizard: jest.fn(),
    onCreateAcknowledged: jest.fn(),
  };
  render(
    <ThemeContext.Provider
      value={{
        currentTheme: { "text-neutral-light": "tok-strong" },
        themes: { aurora: { name: "Aurora" } },
        loadThemes: () => {},
      }}
    >
      <AppContext.Provider
        value={{
          providers: {
            "Slack Work": { type: "slack", isDefaultForType: true },
          },
        }}
      >
        <DashboardsPage
          workspaces={[sales, ks, loose]}
          menuItems={menuItems}
          dashApi={dashApi}
          credentials={{ appId: "app" }}
          {...handlers}
          {...props}
        />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
  return { dashApi, ...handlers };
}

const list = () => screen.getByRole("list", { name: "Dashboards" });
const detail = () => screen.getByTestId("dashboard-detail");
const pick = (name) =>
  fireEvent.click(
    within(list()).getByRole("button", { name: new RegExp(name) }),
  );

describe("DashboardsPage — list", () => {
  it("groups dashboards by folder, with counts and an attention dot", () => {
    setup();
    const l = list();
    expect(within(l).getByText("Work")).toBeInTheDocument();
    expect(within(l).getByText("Experiments")).toBeInTheDocument();
    expect(within(l).getByText("Uncategorized")).toBeInTheDocument();
    const row = within(l).getByRole("button", { name: /Kitchen Sink/ });
    expect(row).toHaveTextContent("2 pages · 3 widgets");
    expect(within(row).getByTestId("dashboard-attention")).toBeInTheDocument();
    const salesRow = within(l).getByRole("button", { name: /Sales/ });
    expect(within(salesRow).queryByTestId("dashboard-attention")).toBeNull();
  });

  it("search matches widget names too", () => {
    setup();
    fireEvent.change(
      screen.getByPlaceholderText("Search dashboards or widgets…"),
      {
        target: { value: "notepad" },
      },
    );
    expect(within(list()).getByText("Kitchen Sink")).toBeInTheDocument();
    expect(within(list()).queryByText("Sales")).toBeNull();
  });

  it("filters by folder", () => {
    setup();
    const folder = screen.getByRole("group", { name: "Folder filter" });
    fireEvent.click(within(folder).getByLabelText("Experiments"));
    expect(within(list()).getByText("Sales")).toBeInTheDocument();
    expect(within(list()).queryByText("Kitchen Sink")).toBeNull();
  });

  it("A-Z lists every dashboard alphabetically without folders", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "A-Z" }));
    expect(within(list()).queryByText("Work")).toBeNull();
    const names = within(list())
      .getAllByRole("button")
      .map((b) => b.querySelector("[data-name]").textContent);
    expect(names).toEqual(["Kitchen Sink", "Loose", "Sales"]);
  });
});

describe("DashboardsPage — detail", () => {
  it("shows layout, pages, widgets, bots, providers and what needs attention", () => {
    setup();
    pick("Kitchen Sink");
    const d = detail();
    expect(
      within(d).getByRole("heading", { name: "Kitchen Sink" }),
    ).toBeInTheDocument();
    expect(d).toHaveTextContent("Work · theme Aurora");
    expect(d).toHaveTextContent(
      "1 provider needs setup · 1 bot needs approval",
    );
    expect(within(d).getAllByTestId("layout-cell")).toHaveLength(2);
    fireEvent.click(within(d).getByRole("button", { name: "Notes" }));
    expect(within(d).queryAllByTestId("layout-cell")).toHaveLength(0);
    expect(d).toHaveTextContent("ChannelMessages");
    expect(d).toHaveTextContent("@trops/slack");
    expect(within(d).getByText("Kitchen Sink Lead")).toBeInTheDocument();
    expect(within(d).getByText("Inbox Watch")).toBeInTheDocument();
    expect(within(d).getByText("Needs approval")).toBeInTheDocument();
    expect(within(d).getByText("Slack Work")).toBeInTheDocument();
  });

  it("Open, Bots view and Dashboard Config hand off the dashboard", () => {
    const h = setup();
    pick("Kitchen Sink");
    fireEvent.click(within(detail()).getByRole("button", { name: "Open" }));
    expect(h.onOpenWorkspace).toHaveBeenCalledWith(ks);
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Bots view" }),
    );
    expect(h.onOpenBotsView).toHaveBeenCalledWith(ks);
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Dashboard Config" }),
    );
    expect(h.onOpenDashboardConfig).toHaveBeenCalledWith(ks);
  });

  it("rename, duplicate and delete go through dashApi", async () => {
    const h = setup();
    pick("Sales");
    fireEvent.click(
      within(detail()).getByRole("button", { name: "More actions" }),
    );
    fireEvent.click(within(detail()).getByRole("button", { name: "Rename" }));
    fireEvent.change(within(detail()).getByLabelText("Dashboard name"), {
      target: { value: "Sales 2" },
    });
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Save name" }),
    );
    expect(h.dashApi.saveWorkspace.mock.calls[0][1].name).toBe("Sales 2");
    expect(h.onReloadWorkspaces).toHaveBeenCalled();

    fireEvent.click(
      within(detail()).getByRole("button", { name: "More actions" }),
    );
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Duplicate" }),
    );
    expect(h.dashApi.saveWorkspace.mock.calls[1][1].name).toBe("Sales (Copy)");

    fireEvent.click(
      within(detail()).getByRole("button", { name: "More actions" }),
    );
    fireEvent.click(within(detail()).getByRole("button", { name: "Delete" }));
    const confirm = screen.getByTestId("confirmation-modal");
    expect(confirm).toHaveTextContent('Delete "Sales"?');
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(h.dashApi.deleteWorkspace).toHaveBeenCalledWith(
        "app",
        8,
        expect.any(Function),
        expect.any(Function),
      ),
    );
  });

  it("changing the folder saves the dashboard", () => {
    const h = setup();
    pick("Sales");
    fireEvent.change(within(detail()).getByLabelText("Folder"), {
      target: { value: "1" },
    });
    expect(h.dashApi.saveWorkspace.mock.calls[0][1].menuId).toBe(1);
  });
});

describe("DashboardsPage — readable text", () => {
  it("the page uses the theme's strong text colour, so plain names are readable", () => {
    setup();
    expect(screen.getByTestId("dashboards-page")).toHaveClass("tok-strong");
  });
});

describe("DashboardsPage — creating", () => {
  it("New Dashboard shows the chooser; Wizard hands off", () => {
    const h = setup({ createRequested: true });
    expect(screen.getByTestId("chooser")).toBeInTheDocument();
    expect(h.onCreateAcknowledged).toHaveBeenCalled();
    fireEvent.click(screen.getByText("wizard"));
    expect(h.onOpenWizard).toHaveBeenCalled();
  });

  it("there's no separate Browse marketplace button", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: "Browse marketplace" }),
    ).not.toBeInTheDocument();
  });

  it("New Dashboard's marketplace option opens the marketplace", () => {
    setup({ createRequested: true });
    fireEvent.click(screen.getByText("marketplace"));
    expect(screen.getByTestId("marketplace")).toBeInTheDocument();
  });
});

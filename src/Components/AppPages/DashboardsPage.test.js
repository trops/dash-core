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
const sales = {
  id: 8,
  name: "Sales",
  menuId: 2,
  pages: [],
  layout: [],
  registryRef: {
    package: "@trops/sales",
    kind: "dashboard",
    version: "1.0.0",
    origin: "installed",
  },
  _dashboardConfig: {
    registryPackage: "sales",
    registryScope: "trops",
    version: "1.0.0",
    originalAuthor: "Trops",
  },
};
const loose = { id: 9, name: "Loose", menuId: null, pages: [], layout: [] };
const menuItems = [
  { id: 1, name: "Work" },
  { id: 2, name: "Experiments" },
];

function setup(props = {}) {
  const dashApi = props.dashApi || {
    saveWorkspace: jest.fn((appId, ws, ok) => ok && ok()),
    deleteWorkspace: jest.fn((appId, id, ok) => ok && ok()),
    saveMenuItem: jest.fn((appId, item, ok) => ok && ok(null, {})),
    deleteMenuItem: jest.fn((appId, id, ok) => ok && ok(null, {})),
  };
  const handlers = {
    onOpenWorkspace: jest.fn(),
    onOpenBotsView: jest.fn(),
    onOpenDashboardConfig: jest.fn(),
    onReloadWorkspaces: jest.fn(),
    onReloadMenuItems: jest.fn(),
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

const aside = () => screen.getByRole("navigation", { name: "Folders" });
const column = (key) => screen.getByTestId(`folder-${key}`);
const names = () =>
  within(list())
    .queryAllByTestId("dashboard-row")
    .map((r) => r.querySelector("[data-name]").textContent);

// A drag's dataTransfer, as the browser hands it over.
function dataTransfer() {
  const data = {};
  return {
    types: [],
    setData(k, v) {
      data[k] = v;
      this.types = Object.keys(data);
    },
    getData: (k) => data[k],
    effectAllowed: "",
  };
}
function drag(name, onto) {
  const dt = dataTransfer();
  const row = within(list())
    .getAllByTestId("dashboard-row")
    .find((r) => r.querySelector("[data-name]").textContent === name);
  fireEvent.dragStart(row, { dataTransfer: dt });
  fireEvent.dragOver(onto, { dataTransfer: dt });
  fireEvent.drop(onto, { dataTransfer: dt });
}

describe("DashboardsPage — list", () => {
  it("opens on All dashboards, newest first, with each one's folder and an attention dot", () => {
    setup({
      workspaces: [
        { ...sales, updatedAt: "2026-11-01T00:00:00Z" },
        { ...ks, updatedAt: "2026-11-14T00:00:00Z" },
        loose,
      ],
    });
    expect(names()).toEqual(["Kitchen Sink", "Sales", "Loose"]);
    const l = list();
    expect(screen.getByTestId("dashboard-list-head")).toHaveTextContent(
      "All dashboards · 3 dashboards · newest first",
    );
    const row = within(l).getByRole("button", { name: /Kitchen Sink/ });
    expect(row).toHaveTextContent("2 pages · 3 widgets");
    expect(row).toHaveTextContent("Work");
    expect(within(row).getByTestId("dashboard-attention")).toHaveTextContent(
      "Needs attention",
    );
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

  it("there's no Dashboards / Folders switch, Folder filter or Grouped / A-Z", () => {
    setup();
    expect(screen.queryByRole("radio", { name: "A-Z" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Folder filter" })).toBeNull();
  });
});

describe("DashboardsPage — folder column (NAV-017)", () => {
  it("lists All dashboards, Not in a folder and each folder A–Z with counts", () => {
    setup();
    const rows = within(aside())
      .getAllByRole("button")
      .map((b) => b.querySelector("[data-name]").textContent);
    expect(rows).toEqual([
      "All dashboards",
      "Not in a folder",
      "Experiments",
      "Work",
      "New folder",
    ]);
    expect(column("all")).toHaveTextContent("3");
    expect(column("none")).toHaveTextContent("1");
    expect(column("1")).toHaveTextContent("1");
  });

  it("picking a folder shows only its dashboards — ids saved as text match too", () => {
    setup({
      workspaces: [
        sales,
        ks,
        loose,
        { ...loose, id: 10, name: "Text id", menuId: "1" },
      ],
    });
    fireEvent.click(within(column("1")).getByRole("button"));
    expect(names().sort()).toEqual(["Kitchen Sink", "Text id"]);
    expect(screen.getByTestId("dashboard-list-head")).toHaveTextContent(
      "Work · 2 dashboards",
    );
    expect(column("1")).toHaveTextContent("2");
  });

  it("Not in a folder holds dashboards with no folder or one that's gone", () => {
    setup({
      workspaces: [
        sales,
        ks,
        loose,
        { ...loose, id: 11, name: "Orphan", menuId: 99 },
      ],
    });
    fireEvent.click(within(column("none")).getByRole("button"));
    expect(names().sort()).toEqual(["Loose", "Orphan"]);
  });

  it("a folder link opens the page on that folder", () => {
    setup({ folderLink: { folder: "2", nonce: 1 } });
    expect(names()).toEqual(["Sales"]);
  });

  it("an empty folder says how to fill it", () => {
    setup({ menuItems: [...menuItems, { id: 3, name: "Home" }] });
    fireEvent.click(within(column("3")).getByRole("button"));
    expect(screen.getByTestId("list-empty")).toHaveTextContent(
      "Nothing in Home yet. Drag a dashboard onto it, or use Edit folder to pick some.",
    );
  });

  it("dragging a dashboard onto a folder moves it (the folder's own id)", async () => {
    const h = setup();
    drag("Loose", column("1"));
    expect(h.dashApi.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(h.dashApi.saveWorkspace.mock.calls[0][1].menuId).toBe(1);
    await waitFor(() => expect(h.onReloadWorkspaces).toHaveBeenCalled());
  });

  it("dragging onto Not in a folder takes it out; onto its own folder does nothing", () => {
    const h = setup();
    drag("Kitchen Sink", column("1"));
    expect(h.dashApi.saveWorkspace).not.toHaveBeenCalled();
    drag("Kitchen Sink", column("none"));
    expect(h.dashApi.saveWorkspace.mock.calls[0][1].menuId).toBeNull();
  });
});

describe("DashboardsPage — New folder / Edit folder", () => {
  it("New folder: name, icon, tick dashboards — saves the folder, then moves those", async () => {
    const h = setup();
    fireEvent.click(
      within(screen.getByTestId("new-folder")).getByRole("button"),
    );
    const panel = screen.getByTestId("folder-panel");
    expect(panel).toHaveTextContent("New folder");
    fireEvent.change(within(panel).getByLabelText("Name"), {
      target: { value: "Home" },
    });
    fireEvent.click(within(panel).getByLabelText("Loose"));
    fireEvent.click(within(panel).getByLabelText("Sales"));
    expect(panel).toHaveTextContent("Home, with Sales and Loose.");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Create folder" }),
    );
    await waitFor(() =>
      expect(h.dashApi.saveWorkspace).toHaveBeenCalledTimes(2),
    );
    const folder = h.dashApi.saveMenuItem.mock.calls[0][1];
    expect(folder).toEqual(
      expect.objectContaining({ name: "Home", icon: "folder" }),
    );
    const moved = h.dashApi.saveWorkspace.mock.calls.map((c) => [
      c[1].name,
      c[1].menuId,
    ]);
    expect(moved.sort()).toEqual(
      [
        ["Loose", folder.id],
        ["Sales", folder.id],
      ].sort(),
    );
    expect(h.onReloadMenuItems).toHaveBeenCalled();
  });

  it("New folder without a name says so and saves nothing", () => {
    const h = setup();
    fireEvent.click(
      within(screen.getByTestId("new-folder")).getByRole("button"),
    );
    const panel = screen.getByTestId("folder-panel");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Create folder" }),
    );
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "Give the folder a name.",
    );
    expect(h.dashApi.saveMenuItem).not.toHaveBeenCalled();
  });

  it("Edit folder starts with its dashboards ticked; unticking takes one out", async () => {
    const h = setup();
    fireEvent.click(within(column("1")).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Work actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit folder" }));
    const panel = screen.getByTestId("folder-panel");
    const box = within(panel).getByLabelText("Kitchen Sink");
    expect(box).toBeChecked();
    fireEvent.click(box);
    fireEvent.click(within(panel).getByRole("button", { name: "Save folder" }));
    await waitFor(() =>
      expect(h.dashApi.saveWorkspace).toHaveBeenCalledTimes(1),
    );
    expect(h.dashApi.saveMenuItem.mock.calls[0][1]).toEqual({
      id: 1,
      name: "Work",
      icon: "folder",
    });
    expect(h.dashApi.saveWorkspace.mock.calls[0][1].menuId).toBeNull();
  });

  it("a folder that doesn't save says so and moves nothing", async () => {
    const h = setup({
      dashApi: {
        saveWorkspace: jest.fn((a, ws, ok) => ok && ok()),
        deleteWorkspace: jest.fn(),
        saveMenuItem: jest.fn(
          (a, item, ok, fail) => fail && fail(null, new Error("disk")),
        ),
        deleteMenuItem: jest.fn(),
      },
    });
    fireEvent.click(
      within(screen.getByTestId("new-folder")).getByRole("button"),
    );
    const panel = screen.getByTestId("folder-panel");
    fireEvent.change(within(panel).getByLabelText("Name"), {
      target: { value: "Home" },
    });
    fireEvent.click(within(panel).getByLabelText("Loose"));
    fireEvent.click(
      within(panel).getByRole("button", { name: "Create folder" }),
    );
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Couldn't save the folder. Try again.",
    );
    expect(h.dashApi.saveWorkspace).not.toHaveBeenCalled();
  });

  it("Delete folder keeps its dashboards (they move to Not in a folder)", async () => {
    const h = setup();
    fireEvent.click(within(column("1")).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Work actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    const confirm = screen.getByTestId("confirmation-modal");
    expect(confirm).toHaveTextContent('Delete folder "Work"');
    expect(confirm).toHaveTextContent(
      "Its 1 dashboard stays — it moves to Not in a folder.",
    );
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Delete folder" }),
    );
    await waitFor(() =>
      expect(h.dashApi.deleteMenuItem).toHaveBeenCalledWith(
        "app",
        1,
        expect.any(Function),
        expect.any(Function),
      ),
    );
    expect(h.onReloadMenuItems).toHaveBeenCalled();
    expect(h.onReloadWorkspaces).toHaveBeenCalled();
  });

  it("trying Save again after a dashboard didn't move updates the same folder", async () => {
    let fail = true;
    const h = setup({
      dashApi: {
        saveWorkspace: jest.fn((a, ws, ok, bad) => {
          if (fail) {
            fail = false;
            return bad && bad(null, new Error("disk"));
          }
          return ok && ok();
        }),
        deleteWorkspace: jest.fn(),
        saveMenuItem: jest.fn((a, item, ok) => ok && ok(null, {})),
        deleteMenuItem: jest.fn(),
      },
    });
    fireEvent.click(
      within(screen.getByTestId("new-folder")).getByRole("button"),
    );
    const panel = screen.getByTestId("folder-panel");
    fireEvent.change(within(panel).getByLabelText("Name"), {
      target: { value: "Home" },
    });
    fireEvent.click(within(panel).getByLabelText("Loose"));
    fireEvent.click(
      within(panel).getByRole("button", { name: "Create folder" }),
    );
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Saved the folder, but 1 dashboard didn't move. Try Save again.",
    );
    fireEvent.click(
      within(panel).getByRole("button", { name: "Create folder" }),
    );
    await waitFor(() =>
      expect(h.dashApi.saveMenuItem).toHaveBeenCalledTimes(2),
    );
    const [first, second] = h.dashApi.saveMenuItem.mock.calls.map((c) => c[1]);
    expect(second.id).toBe(first.id);
  });

  it("dropping on the folder it's already in does nothing, whichever way its id was saved", () => {
    const h = setup({
      workspaces: [
        sales,
        ks,
        loose,
        { ...loose, id: 10, name: "Text id", menuId: "1" },
      ],
    });
    drag("Text id", column("1"));
    expect(h.dashApi.saveWorkspace).not.toHaveBeenCalled();
  });

  it("a New folder link opens the panel", () => {
    setup({ folderLink: { newFolder: true, nonce: 2 } });
    expect(screen.getByTestId("folder-panel")).toHaveTextContent("New folder");
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
    expect(d).toHaveTextContent("Channel Messages");
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
    fireEvent.click(within(detail()).getByRole("menuitem", { name: "Rename" }));
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
      within(detail()).getByRole("menuitem", { name: "Duplicate" }),
    );
    expect(h.dashApi.saveWorkspace.mock.calls[1][1].name).toBe("Sales (Copy)");
    // The copy isn't the registry package the original came from.
    expect(
      h.dashApi.saveWorkspace.mock.calls[1][1].registryRef,
    ).toBeUndefined();
    // …nor what it was published as; who made it stays.
    expect(h.dashApi.saveWorkspace.mock.calls[1][1]._dashboardConfig).toEqual({
      originalAuthor: "Trops",
    });
    // It stays credited to the dashboard it copies (publishing it is a remix).
    expect(h.dashApi.saveWorkspace.mock.calls[1][1].remixedFrom).toEqual({
      package: "@trops/sales",
      version: "1.0.0",
    });

    fireEvent.click(
      within(detail()).getByRole("button", { name: "More actions" }),
    );
    fireEvent.click(within(detail()).getByRole("menuitem", { name: "Delete" }));
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

  it("a dashboard outside every folder shows Not in a folder, and can go back to none", () => {
    const h = setup();
    pick("Loose");
    const folder = within(detail()).getByLabelText("Folder");
    expect(folder).toHaveValue("");
    // Once, not twice (QA 2026-10-23: the placeholder option repeated it).
    expect(
      [...folder.options].filter((o) => o.textContent === "Not in a folder"),
    ).toHaveLength(1);
    pick("Sales");
    fireEvent.change(within(detail()).getByLabelText("Folder"), {
      target: { value: "" },
    });
    expect(h.dashApi.saveWorkspace.mock.calls[0][1].menuId).toBeNull();
  });

  it("a page without a grid says so with an empty state", () => {
    setup();
    pick("Kitchen Sink");
    fireEvent.click(within(detail()).getByRole("button", { name: "Notes" }));
    expect(within(detail()).getByTestId("layout-empty")).toHaveTextContent(
      "No layout yet",
    );
  });

  it("the header has no extra-small buttons: overflow actions live in the … menu", () => {
    setup();
    pick("Sales");
    expect(within(detail()).queryByRole("menuitem")).toBeNull();
    fireEvent.click(
      within(detail()).getByRole("button", { name: "More actions" }),
    );
    const items = within(detail())
      .getAllByRole("menuitem")
      .map((i) => i.textContent);
    expect(items).toEqual([
      "Rename",
      "Duplicate",
      "Export ZIP",
      "Publish",
      "Delete",
    ]);
  });
});

describe("DashboardsPage — readable text", () => {
  it("the page uses the theme's strong text colour, so plain names are readable", () => {
    setup();
    expect(screen.getByTestId("dashboards-page")).toHaveClass("tok-strong");
  });
});

// New Dashboard opens Create (AppPage, consolidation Phase 2a); the page
// has no chooser or marketplace of its own.
describe("DashboardsPage — creating", () => {
  it("there's no separate Browse marketplace button", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: "Browse marketplace" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * WidgetsPage — the Widgets Manage page as list + detail, org → package →
 * widgets (app-navigation PRD NAV-008).
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

jest.mock("../../ComponentManager", () => ({ ComponentManager: {} }));

const mockUninstall = jest.fn().mockResolvedValue(true);
const mockRefresh = jest.fn().mockResolvedValue();
jest.mock("../../hooks/useInstalledWidgets", () => {
  const actual = jest.requireActual("../../hooks/useInstalledWidgets");
  return {
    ...actual,
    useInstalledWidgets: () => ({
      widgets: mockWidgets(),
      isLoading: false,
      error: null,
      uninstallWidget: mockUninstall,
      refresh: mockRefresh,
    }),
  };
});
function mockWidgets() {
  return [
    {
      name: "trops.slack.Channels",
      displayName: "Slack Channels",
      packageId: "@trops/slack",
      version: "1.2.0",
      source: "installed",
      kind: "installed",
      path: "/w/slack",
      providers: [
        { type: "slack", requiredTools: ["list_channels"], required: true },
      ],
      componentNames: ["trops.slack.Channels"],
    },
    {
      name: "trops.slack.Messages",
      displayName: "Channel Messages",
      description: "Recent messages in a channel",
      packageId: "@trops/slack",
      version: "1.2.0",
      source: "installed",
      kind: "installed",
      providers: [],
      componentNames: ["trops.slack.Messages"],
    },
    {
      name: "acme.chart.Bar",
      displayName: "Bar Chart",
      packageId: "@acme/charts",
      version: "0.3.1",
      source: "installed",
      kind: "installed",
      providers: [],
      componentNames: ["acme.chart.Bar"],
    },
    {
      name: "ai-built.draft-x.Thing",
      displayName: "Thing",
      packageId: "@ai-built/draft-x",
      source: "installed",
      kind: "draft",
      draftId: "x",
      providers: [],
      componentNames: ["ai-built.draft-x.Thing"],
    },
    {
      name: "Notepad",
      displayName: "Notepad",
      package: "Dash Samples",
      source: "builtin",
      kind: "installed",
      providers: [],
      componentNames: ["Notepad"],
    },
  ];
}

const mockUpdateWidget = jest.fn().mockResolvedValue(true);
jest.mock("../../hooks/useWidgetUpdates", () => ({
  useWidgetUpdates: () => ({
    updates: new Map([["trops.slack.Channels", { latestVersion: "1.3.0" }]]),
    packagesWithUpdates: [{ packageName: "@trops/slack" }],
    isChecking: false,
    updateWidget: mockUpdateWidget,
    updatePackages: jest.fn(),
    batchStatus: {},
    isBatchUpdating: false,
    isUpdating: null,
    updateError: null,
    pendingPreflight: null,
    resolvePreflight: jest.fn(),
  }),
}));
const mockEnsureAuthed = jest.fn().mockResolvedValue(true);
jest.mock("../../hooks/useRegistryAuthGate", () => ({
  useRegistryAuthGate: () => ({
    ensureAuthed: mockEnsureAuthed,
    authGate: null,
  }),
}));
jest.mock("../Settings/details/InstallWidgetPicker", () => ({
  InstallWidgetPicker: ({ onSelect }) => (
    <div data-testid="install-picker">
      <button onClick={() => onSelect("zip")}>pick-zip</button>
      <button onClick={() => onSelect("builder")}>pick-builder</button>
      <button onClick={() => onSelect("discover")}>pick-discover</button>
    </div>
  ),
}));
jest.mock("../Settings/details/DiscoverWidgetsDetail", () => ({
  DiscoverWidgetsDetail: () => <div data-testid="discover" />,
}));
jest.mock("../Settings/details/InstallProgressModal", () => ({
  InstallProgressModal: () => null,
}));
jest.mock("../Settings/details/PublishWidgetModal", () => ({
  PublishWidgetModal: ({ isOpen, widget }) =>
    isOpen ? <div data-testid="publish">{widget.packageId}</div> : null,
}));
jest.mock("../Settings/sections/UpdateAllWidgetsModal", () => ({
  UpdateAllWidgetsModal: ({ isOpen }) =>
    isOpen ? <div data-testid="update-all" /> : null,
}));
jest.mock("../WidgetPreflightReview", () => ({
  WidgetPreflightReview: () => null,
}));
const mockInstallFromZip = jest.fn().mockResolvedValue();
// The live preview has its own tests; here it just reports its props.
jest.mock("./WidgetPreview", () => ({
  WidgetPreview: ({ widget, onSetUpProvider }) => (
    <div data-testid="widget-preview">
      {widget.name}
      <button onClick={() => onSetUpProvider("slack", "mcp")}>
        preview-setup
      </button>
    </div>
  ),
}));
jest.mock("./useWidgetInstall", () => ({
  useWidgetInstall: () => ({
    progress: { open: false, complete: false, widgets: [] },
    result: { status: "success", message: 'Widget "weather" installed.' },
    installFromZip: mockInstallFromZip,
    loadFolder: jest.fn(),
    closeProgress: jest.fn(),
    clearResult: jest.fn(),
  }),
}));

import { WidgetsPage } from "./WidgetsPage";

const workspaces = [
  {
    id: 1,
    name: "Kitchen Sink",
    layout: [{ component: "trops.slack.Messages" }, { component: "Notepad" }],
  },
];

function setup(props = {}) {
  const drafts = { delete: jest.fn().mockResolvedValue(true) };
  window.mainApi = { drafts, shell: { openPath: jest.fn() } };
  const onOpenWorkspace = jest.fn();
  const onOpenPrivacySettings = jest.fn();
  const utils = render(
    <WidgetsPage
      workspaces={workspaces}
      credentials={{ appId: "app" }}
      onOpenWorkspace={onOpenWorkspace}
      onOpenPrivacySettings={onOpenPrivacySettings}
      {...props}
    />,
  );
  return { ...utils, drafts, onOpenWorkspace, onOpenPrivacySettings };
}

const list = () => screen.getByRole("list", { name: "Widgets" });
const detail = () => screen.getByTestId("widget-detail");
const pkgRow = (label) =>
  within(list())
    .getAllByRole("button")
    .find((b) => b.getAttribute("data-package") === label);
const pkgLabels = () =>
  within(list())
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("data-package"))
    .map((b) => b.getAttribute("data-package"));

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  delete window.mainApi;
});

describe("WidgetsPage list (NAV-008 AC1, AC2)", () => {
  it("lists org → package with counts; Built-in last", () => {
    setup();
    const headings = within(list())
      .getAllByTestId("org-heading")
      .map((h) => h.textContent);
    expect(headings).toEqual(["@acme", "@trops", "AI-built", "Built-in"]);
    expect(pkgLabels()).toEqual([
      "charts",
      "slack",
      "Thing (draft)",
      "Dash Samples",
    ]);
    expect(
      within(pkgRow("slack")).getByText("2 widgets · v1.2.0"),
    ).toBeTruthy();
    expect(within(pkgRow("slack")).getByTestId("package-update")).toBeTruthy();
  });

  it("selecting a package expands its widgets in the list", () => {
    setup();
    expect(within(list()).queryByText("Channel Messages")).toBeNull();
    fireEvent.click(pkgRow("slack"));
    expect(within(list()).getByText("Channel Messages")).toBeInTheDocument();
    expect(within(list()).getByText("Slack Channels")).toBeInTheDocument();
  });

  it("search on a widget shows just that widget under its package", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "recent messages" },
    });
    expect(pkgLabels()).toEqual(["slack"]);
    expect(within(list()).getByText("Channel Messages")).toBeInTheDocument();
    expect(within(list()).queryByText("Slack Channels")).toBeNull();
  });

  it("filters by org and by in use / not used / mine", () => {
    setup();
    const org = screen.getByRole("group", { name: "Org filter" });
    fireEvent.click(within(org).getByLabelText(/@acme/));
    expect(pkgLabels()).toEqual(["charts"]);
    fireEvent.click(within(org).getByLabelText(/@acme/));
    fireEvent.click(screen.getByRole("radio", { name: "In use" }));
    expect(pkgLabels()).toEqual(["slack", "Dash Samples"]);
    fireEvent.click(screen.getByRole("radio", { name: "Mine" }));
    expect(pkgLabels()).toEqual(["Thing (draft)"]);
    fireEvent.click(screen.getByRole("radio", { name: "Not used" }));
    expect(pkgLabels()).toEqual(["charts", "Thing (draft)"]);
  });
});

describe("WidgetsPage package detail (NAV-008 AC3)", () => {
  it("shows name, version, source, widgets, used on and providers", () => {
    const { onOpenWorkspace } = setup();
    fireEvent.click(pkgRow("slack"));
    const d = detail();
    expect(within(d).getByText("@trops/slack")).toBeInTheDocument();
    expect(within(d).getByText("Installed · v1.2.0")).toBeInTheDocument();
    expect(within(d).getByText("Recent messages in a channel")).toBeTruthy();
    expect(within(d).getByText("Slack Channels")).toBeInTheDocument();
    expect(
      within(within(d).getByTestId("needs-providers")).getByText("slack"),
    ).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Open" }));
    expect(onOpenWorkspace).toHaveBeenCalledWith(workspaces[0]);
  });

  it("updates the package after the registry sign-in check", async () => {
    setup();
    fireEvent.click(pkgRow("slack"));
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Update to v1.3.0" }),
    );
    await waitFor(() =>
      expect(mockUpdateWidget).toHaveBeenCalledWith("trops.slack.Channels"),
    );
    expect(mockEnsureAuthed).toHaveBeenCalled();
  });

  it("uninstall asks first (naming the dashboards), then removes the package", async () => {
    setup();
    fireEvent.click(pkgRow("slack"));
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Uninstall" }),
    );
    const modal = screen.getByTestId("confirmation-modal");
    expect(
      within(modal).getByText(
        "This removes its 2 widgets. They're used on 1 dashboard (Kitchen Sink), which will show them as missing.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(modal).getByText("Uninstall"));
    await waitFor(() =>
      expect(mockUninstall).toHaveBeenCalledWith("trops.slack.Channels"),
    );
  });

  it("publishes, opens in Finder and manages permissions", () => {
    const { onOpenPrivacySettings } = setup();
    fireEvent.click(pkgRow("slack"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Publish…" }));
    expect(screen.getByTestId("publish")).toHaveTextContent("@trops/slack");
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Open in Finder" }),
    );
    expect(window.mainApi.shell.openPath).toHaveBeenCalledWith("/w/slack");
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Manage permissions" }),
    );
    expect(onOpenPrivacySettings).toHaveBeenCalled();
  });

  it("a draft can be resumed or deleted", async () => {
    const { drafts } = setup();
    const events = [];
    const onEvent = (e) => events.push(e.detail);
    window.addEventListener("dash:open-widget-builder", onEvent);
    fireEvent.click(pkgRow("Thing (draft)"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Resume" }));
    expect(events).toEqual([{ resumeDraftId: "x" }]);
    window.removeEventListener("dash:open-widget-builder", onEvent);
    expect(within(detail()).queryByRole("button", { name: "Publish…" })).toBe(
      null,
    );
    fireEvent.click(within(detail()).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByTestId("confirmation-modal")).getByText("Delete"),
    );
    await waitFor(() => expect(drafts.delete).toHaveBeenCalledWith("x"));
  });

  it("built-in widgets can't be updated, published or uninstalled", () => {
    setup();
    fireEvent.click(pkgRow("Dash Samples"));
    expect(within(detail()).getByText("Built-in")).toBeInTheDocument();
    for (const name of ["Uninstall", "Publish…", "Manage permissions"]) {
      expect(within(detail()).queryByRole("button", { name })).toBeNull();
    }
  });
});

describe("WidgetsPage widget detail (NAV-008 AC4)", () => {
  it("shows the widget with a link back to its package", () => {
    setup();
    fireEvent.click(pkgRow("slack"));
    fireEvent.click(within(list()).getByText("Slack Channels"));
    const d = detail();
    expect(
      within(d).getAllByText("trops.slack.Channels")[0],
    ).toBeInTheDocument();
    expect(within(d).getByText("list_channels")).toBeInTheDocument();
    expect(within(d).getByText("Not on any dashboard yet")).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "← slack" }));
    expect(within(detail()).getByText("@trops/slack")).toBeInTheDocument();
  });
});

describe("WidgetsPage live preview (NAV-011)", () => {
  it("the widget detail has the live preview for that widget", () => {
    setup();
    fireEvent.click(pkgRow("slack"));
    fireEvent.click(within(list()).getByText("Slack Channels"));
    expect(within(detail()).getByTestId("widget-preview")).toHaveTextContent(
      "trops.slack.Channels",
    );
  });

  it("each widget row in the package detail has Preview", () => {
    setup();
    fireEvent.click(pkgRow("slack"));
    const previews = within(detail()).getAllByRole("button", {
      name: "Preview",
    });
    expect(previews).toHaveLength(2);
    fireEvent.click(previews[1]);
    expect(within(detail()).getByTestId("widget-preview")).toHaveTextContent(
      "trops.slack.Messages",
    );
  });

  it("Set up starts the provider create flow", () => {
    const events = [];
    const onEvent = (e) => events.push(e.detail);
    window.addEventListener("dash:open-settings-create-provider", onEvent);
    setup();
    fireEvent.click(pkgRow("slack"));
    fireEvent.click(within(list()).getByText("Slack Channels"));
    fireEvent.click(screen.getByText("preview-setup"));
    window.removeEventListener("dash:open-settings-create-provider", onEvent);
    expect(events).toEqual([{ type: "slack", providerClass: "mcp" }]);
  });
});

describe("WidgetsPage page actions", () => {
  it("Update all opens the update modal", () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "1 update · Update all" }),
    );
    expect(screen.getByTestId("update-all")).toBeInTheDocument();
  });

  it("cleans up drafts after confirming", async () => {
    const { drafts } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Clean up 1 draft" }));
    const modal = screen.getByTestId("confirmation-modal");
    fireEvent.click(within(modal).getByText("Delete 1 draft"));
    await waitFor(() => expect(drafts.delete).toHaveBeenCalledWith("x"));
  });

  it("New Widget shows the install picker; a ZIP install shows the result", async () => {
    const onCreateAcknowledged = jest.fn();
    setup({ createRequested: true, onCreateAcknowledged });
    expect(onCreateAcknowledged).toHaveBeenCalled();
    fireEvent.click(screen.getByText("pick-zip"));
    await waitFor(() => expect(mockInstallFromZip).toHaveBeenCalled());
    expect(
      await screen.findByText('Widget "weather" installed.'),
    ).toBeInTheDocument();
  });

  it("the builder card opens the Widget Builder", () => {
    setup({ createRequested: true });
    let fired = false;
    const onEvent = () => {
      fired = true;
    };
    window.addEventListener("dash:open-widget-builder", onEvent);
    fireEvent.click(screen.getByText("pick-builder"));
    window.removeEventListener("dash:open-widget-builder", onEvent);
    expect(fired).toBe(true);
    expect(screen.queryByTestId("install-picker")).toBeNull();
  });
});

/**
 * WidgetPreview — a widget rendered live on the Widgets page, through the
 * host's sandboxed preview renderer (app-navigation PRD NAV-011); uses the
 * user's default provider for each type the widget needs. It runs by itself
 * unless it would start a server (an MCP provider) — that one waits for
 * Start preview (consolidation Phase 4b). The Slack widget here is MCP.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { setWidgetPreviewRenderer } from "../../utils/widgetPreviewRenderer";
import { WidgetPreview } from "./WidgetPreview";

// A stand-in for the host's iframe renderer: shows what it was given and
// exposes the callbacks.
let lastProps = null;
function FakeRenderer(props) {
  lastProps = props;
  return (
    <div data-testid="sandbox">
      {props.componentName}|{props.bundleSource}
    </div>
  );
}

const slackWidget = {
  name: "trops.slack.Channels",
  displayName: "Slack Channels",
  packageId: "@trops/slack",
  source: "installed",
  kind: "installed",
  providers: [{ type: "slack", providerClass: "mcp", required: true }],
};
const appProviders = {
  "Slack Work": { type: "slack", providerClass: "mcp", isDefaultForType: true },
  Other: { type: "slack", providerClass: "mcp" },
};
const getWidgetConfig = () => ({
  userConfig: {
    title: { defaultValue: "My channels" },
    limit: { defaultValue: 5 },
    noDefault: { type: "text" },
  },
});

function setup(props = {}, readBundle) {
  window.mainApi = {
    widgets: {
      readBundle:
        readBundle ||
        jest
          .fn()
          .mockResolvedValue({ success: true, source: "module.exports={}" }),
    },
  };
  const onSetUpProvider = jest.fn();
  const utils = render(
    <WidgetPreview
      widget={slackWidget}
      appProviders={appProviders}
      getWidgetConfig={getWidgetConfig}
      onSetUpProvider={onSetUpProvider}
      {...props}
    />,
  );
  return { ...utils, onSetUpProvider };
}

beforeEach(() => {
  lastProps = null;
  setWidgetPreviewRenderer(FakeRenderer);
});
afterEach(() => {
  setWidgetPreviewRenderer(null);
  delete window.mainApi;
});

describe("WidgetPreview (NAV-011)", () => {
  it("a widget that starts a server doesn't run until asked, and says why", () => {
    setup();
    expect(screen.queryByTestId("sandbox")).toBeNull();
    expect(window.mainApi.widgets.readBundle).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview-status")).toHaveTextContent(
      "This preview starts your Slack server and calls the real service. Uses Slack Work.",
    );
  });

  it("Run preview loads the package bundle and mounts the widget in the sandbox", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    expect(await screen.findByTestId("sandbox")).toHaveTextContent(
      "Channels|module.exports={}",
    );
    expect(window.mainApi.widgets.readBundle).toHaveBeenCalledWith(
      "@trops/slack",
    );
    // The provider types, plus the sandbox's "mcp" namespace for an MCP
    // provider (its mainApi gate blocks undeclared credentialed namespaces).
    expect(lastProps.declaredProviders).toEqual(["slack", "mcp"]);
    expect(lastProps.widgetData.selectedProviders).toEqual({
      slack: "Slack Work",
    });
    expect(lastProps.props).toEqual({ title: "My channels", limit: 5 });
  });

  it("a package-level entry mounts its registered component, not the package name", async () => {
    setup({
      widget: {
        ...slackWidget,
        name: "@trops/gmail",
        packageId: "@trops/gmail",
        componentNames: ["trops.gmail.GmailInbox", "trops.gmail.GmailSend"],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    expect(await screen.findByTestId("sandbox")).toHaveTextContent(
      "GmailInbox|",
    );
  });

  it("Stop unmounts it; Reload loads it again", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    await screen.findByTestId("sandbox");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(window.mainApi.widgets.readBundle).toHaveBeenCalledTimes(2),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.queryByTestId("sandbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Start preview" })).toBeTruthy();
  });

  it("shows the widget's own error from the sandbox", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    await screen.findByTestId("sandbox");
    act(() => lastProps.onError({ message: "x is undefined" }));
    expect(
      screen.getByText("This widget hit an error: x is undefined"),
    ).toBeInTheDocument();
  });

  it("says when the bundle can't be loaded", async () => {
    setup(
      {},
      jest.fn().mockResolvedValue({ success: false, error: "no dist" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    expect(
      await screen.findByText("Couldn't load this widget's code: no dist"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("sandbox")).toBeNull();
  });

  it("a required provider with nothing set up: no run, a Set up link", () => {
    const { onSetUpProvider } = setup({ appProviders: {} });
    expect(
      screen.getByText("Needs a slack provider to show live data."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start preview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(onSetUpProvider).toHaveBeenCalledWith("slack", "mcp");
  });

  it("picks the default for the type, and the provider can be changed", async () => {
    setup();
    const picker = screen.getByLabelText("slack provider");
    expect(picker).toHaveValue("Slack Work");
    fireEvent.change(picker, { target: { value: "Other" } });
    expect(screen.getByText(/Uses Other/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    await screen.findByTestId("sandbox");
    expect(lastProps.widgetData.selectedProviders).toEqual({ slack: "Other" });
  });

  it("only offers providers of the class the widget needs", () => {
    setup({
      widget: {
        ...slackWidget,
        providers: [
          { type: "algolia", providerClass: "credential", required: true },
        ],
      },
      appProviders: {
        "Algolia Keys": { type: "algolia", credentials: { apiKey: "k" } },
        "Algolia MCP": { type: "algolia", providerClass: "mcp" },
      },
    });
    const picker = screen.getByLabelText("algolia provider");
    expect(
      Array.from(picker.querySelectorAll("option")).map((o) => o.textContent),
    ).toEqual(["Algolia Keys"]);
    expect(picker).toHaveValue("Algolia Keys");
  });

  it("with no default, the only provider of that type is used", () => {
    setup({
      appProviders: { Other: { type: "slack", providerClass: "mcp" } },
    });
    expect(screen.getByLabelText("slack provider")).toHaveValue("Other");
    expect(screen.getByRole("button", { name: "Start preview" })).toBeTruthy();
  });

  it("several and no default: choose one before running", () => {
    setup({
      appProviders: {
        A: { type: "slack", providerClass: "mcp" },
        B: { type: "slack", providerClass: "mcp" },
      },
    });
    expect(
      screen.getByText("Choose a slack provider to run the preview."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start preview" })).toBeNull();
    fireEvent.change(screen.getByLabelText("slack provider"), {
      target: { value: "B" },
    });
    expect(screen.getByRole("button", { name: "Start preview" })).toBeTruthy();
  });

  it("changing the provider stops a running preview", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    await screen.findByTestId("sandbox");
    fireEvent.change(screen.getByLabelText("slack provider"), {
      target: { value: "Other" },
    });
    expect(screen.queryByTestId("sandbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Start preview" })).toBeTruthy();
  });

  it("built-in widgets and hosts without a sandbox don't offer a preview", () => {
    const { unmount } = setup({
      widget: { ...slackWidget, source: "builtin", providers: [] },
    });
    expect(
      screen.getByText("Preview isn't available for built-in widgets."),
    ).toBeInTheDocument();
    unmount();
    setWidgetPreviewRenderer(null);
    setup();
    expect(
      screen.getByText("Live preview isn't available in this app."),
    ).toBeInTheDocument();
  });

  describe("runs by itself (consolidation Phase 4b)", () => {
    const plain = {
      ...slackWidget,
      name: "ai.counter.Counter",
      packageId: "@ai-built/counter",
      providers: [],
    };
    const keys = {
      ...slackWidget,
      name: "trops.algolia.Search",
      packageId: "@trops/algolia",
      providers: [
        { type: "algolia", providerClass: "credential", required: true },
      ],
    };

    it("a widget with no connection runs as soon as it opens", async () => {
      setup({ widget: plain, appProviders: {} });
      expect(await screen.findByTestId("sandbox")).toHaveTextContent(
        "Counter|",
      );
      expect(
        screen.queryByRole("button", { name: "Start preview" }),
      ).toBeNull();
    });

    it("a credential connection runs by itself; Stop stays stopped until Reload", async () => {
      setup({
        widget: keys,
        appProviders: {
          "Algolia Keys": { type: "algolia", isDefaultForType: true },
        },
      });
      await screen.findByTestId("sandbox");
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(screen.queryByTestId("sandbox")).toBeNull();
      expect(window.mainApi.widgets.readBundle).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      expect(await screen.findByTestId("sandbox")).toBeInTheDocument();
    });

    it("several connections and no default: waits for a pick, then runs", async () => {
      setup({
        widget: keys,
        appProviders: {
          A: { type: "algolia" },
          B: { type: "algolia" },
        },
      });
      expect(window.mainApi.widgets.readBundle).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("algolia provider"), {
        target: { value: "B" },
      });
      expect(await screen.findByTestId("sandbox")).toBeInTheDocument();
      expect(lastProps.widgetData.selectedProviders).toEqual({ algolia: "B" });
    });

    it("a failed load says why, with Try again", async () => {
      setup(
        { widget: plain, appProviders: {} },
        jest.fn().mockResolvedValue({ success: false, error: "no dist" }),
      );
      expect(
        await screen.findByText("Couldn't load this widget's code: no dist"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    });
  });

  it("a load that finishes after Stop is dropped; running says what it runs with", async () => {
    let finish;
    setup(
      {},
      jest.fn(
        () =>
          new Promise((r) => {
            finish = r;
          }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await act(async () => finish({ success: true, source: "late" }));
    expect(screen.queryByTestId("sandbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    await act(async () => finish({ success: true, source: "fresh" }));
    expect(screen.getByTestId("sandbox")).toHaveTextContent("fresh");
    expect(screen.getByTestId("preview-status")).toHaveTextContent(
      "Running with Slack Work.",
    );
  });
});

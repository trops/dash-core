import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { PublishFlowModal } from "./PublishFlowModal";
import { InstallFlowModal } from "./InstallFlowModal";
import { UpdateFlowModal } from "./UpdateFlowModal";
import { installMockFlowsApi } from "../../__mocks__/mockFlowsApi";

const flow = { id: "flow_news01", name: "Ticket to PR", workspaceId: "ws1" };

describe("PublishFlowModal (frame 33)", () => {
  it("shows what's in it, what it needs, what's left out and its checks, then publishes the version chosen", async () => {
    const { api } = installMockFlowsApi();
    const onPublished = jest.fn();
    render(
      <PublishFlowModal
        flow={flow}
        onClose={jest.fn()}
        onPublished={onPublished}
      />,
    );
    expect(await screen.findByTestId("publish-contents")).toHaveTextContent(
      "Ticket reader, Builder, Reviewer",
    );
    expect(screen.getByTestId("publish-left-out")).toHaveTextContent(
      "scripts/notify-me.sh (only on this computer)",
    );
    expect(screen.getByTestId("publish-checks")).toHaveTextContent(
      "No keys or tokens found in the files",
    );
    expect(screen.getByText("A folder to work in")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Big change · 2.0.0" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish 2.0.0" }));
    await waitFor(() => expect(api.publish).toHaveBeenCalled());
    expect(api.publish.mock.calls[0][1]).toMatchObject({
      name: "@trops/ticket-to-pr",
      version: "2.0.0",
    });
    expect(onPublished).toHaveBeenCalled();
  });
});

describe("InstallFlowModal (frame 34)", () => {
  it("Install turns on only once its script is read", async () => {
    const { api } = installMockFlowsApi();
    const onInstalled = jest.fn();
    render(
      <InstallFlowModal
        packageRef="@trops/ticket-to-pr"
        workspace={{ id: "ws1", name: "Dash app" }}
        onClose={jest.fn()}
        onInstalled={onInstalled}
      />,
    );
    const scripts = await screen.findByTestId("install-scripts");
    expect(
      within(scripts).getByText("scripts/lint-changed.js"),
    ).toBeInTheDocument();
    const install = screen.getByRole("button", { name: "Install" });
    expect(install).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Folder"), {
      target: { value: "/Users/me/app" },
    });
    expect(install).toBeDisabled();
    fireEvent.click(
      within(scripts).getByLabelText("I've read it. Let it run."),
    );
    expect(install).not.toBeDisabled();
    fireEvent.click(install);
    await waitFor(() => expect(api.install).toHaveBeenCalled());
    expect(api.install.mock.calls[0][1]).toMatchObject({
      workspaceId: "ws1",
      providers: { github: "GitHub · trops" },
      folder: "/Users/me/app",
      scriptsRead: true,
    });
    expect(onInstalled).toHaveBeenCalled();
  });
});

describe("UpdateFlowModal (frame 35)", () => {
  it("lists the changes, shows the changed script, asks about your own change, and needs the script read", async () => {
    const { api } = installMockFlowsApi();
    render(
      <UpdateFlowModal flow={flow} onClose={jest.fn()} onUpdated={jest.fn()} />,
    );
    expect(
      await screen.findByText("Update Ticket to PR: 1.2.0 → 1.3.0"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("update-changes")).toHaveTextContent(
      "Adds a step: Lint",
    );
    expect(screen.getByTestId("update-script")).toHaveTextContent(
      "scripts/check-pr.js",
    );
    expect(screen.getByTestId("update-conflict")).toHaveTextContent(
      "Yours: 45 min",
    );
    expect(screen.getByTestId("update-running")).toHaveTextContent(
      "2 goals already running finish on 1.2.0",
    );
    const update = screen.getByRole("button", { name: "Update" });
    expect(update).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Take theirs" }));
    fireEvent.click(
      screen.getByLabelText("I've read the changed scripts. Let them run."),
    );
    fireEvent.click(update);
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][1]).toEqual({
      keep: { "builder.runLimits": "theirs" },
      approveScripts: true,
    });
  });

  it("skip this version", async () => {
    const { api } = installMockFlowsApi();
    const onClose = jest.fn();
    render(
      <UpdateFlowModal flow={flow} onClose={onClose} onUpdated={jest.fn()} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Skip this version" }),
    );
    await waitFor(() =>
      expect(api.skipVersion).toHaveBeenCalledWith("flow_news01", "1.3.0"),
    );
  });
});

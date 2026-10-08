import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProviderUseDialog } from "./ProviderUseDialog";

const model = {
  providerName: "Slack Dash Comms",
  providerType: "slack",
  defaultName: null,
  dashboards: [
    {
      workspaceId: 1,
      workspaceName: "Daily Brief",
      rows: [
        {
          key: "w:1:feed",
          widgetId: "feed",
          label: "Channel Digest",
          current: { kind: "explicit", name: "Slack", needsSetup: true },
          usesThis: false,
          locked: false,
        },
        {
          key: "w:1:compose",
          widgetId: "compose",
          label: "Composer",
          current: {
            kind: "explicit",
            name: "Slack Dash Comms",
            needsSetup: false,
          },
          usesThis: true,
          locked: false,
        },
      ],
    },
    {
      workspaceId: 2,
      workspaceName: "Kitchen Sink",
      rows: [
        {
          key: "w:2:k",
          widgetId: "k",
          label: "Slack Feed",
          current: { kind: "none", name: null, needsSetup: false },
          usesThis: false,
          locked: false,
        },
      ],
    },
  ],
  bots: [
    {
      key: "b:b1",
      botId: "b1",
      name: "Digest",
      workspaceId: 1,
      usesThis: false,
      others: ["Slack"],
    },
  ],
};

const box = (label) => screen.getByLabelText(label);
const renderDialog = (props = {}) =>
  render(
    <ProviderUseDialog
      isOpen
      model={model}
      onSave={props.onSave || jest.fn(async () => null)}
      onClose={props.onClose || jest.fn()}
      {...props}
    />,
  );

describe("ProviderUseDialog (NAV-015)", () => {
  it("lists widgets by dashboard and bots, ticked where this provider is used", () => {
    renderDialog();
    expect(screen.getByText("Use Slack Dash Comms for…")).toBeInTheDocument();
    expect(screen.getByText("Daily Brief")).toBeInTheDocument();
    expect(screen.getByText("Kitchen Sink")).toBeInTheDocument();
    expect(box("Channel Digest")).not.toBeChecked();
    expect(box("Composer")).toBeChecked();
    expect(box("Digest")).not.toBeChecked();
  });

  it("shows what each row uses now, with a needs-setup warning", () => {
    renderDialog();
    expect(screen.getByTestId("now-w:1:feed")).toHaveTextContent(
      "now: Slack · needs setup",
    );
    expect(screen.getByTestId("now-w:2:k")).toHaveTextContent(
      "now: no provider",
    );
    expect(screen.getByTestId("now-b:b1")).toHaveTextContent(
      "also uses: Slack",
    );
  });

  it("unticking shows the fallback (none set) and counts the change", () => {
    renderDialog();
    fireEvent.click(box("Composer"));
    expect(screen.getByTestId("after-w:1:compose")).toHaveTextContent(
      "→ uses default: none set",
    );
    expect(
      screen.getByRole("button", { name: "Save — 1 change" }),
    ).toBeEnabled();
  });

  it("shows the default's name when the type has one", () => {
    renderDialog({ model: { ...model, defaultName: "Slack Prod" } });
    fireEvent.click(box("Composer"));
    expect(screen.getByTestId("after-w:1:compose")).toHaveTextContent(
      "→ uses default: Slack Prod",
    );
  });

  it("Select all needing setup ticks rows whose provider needs setup or is missing", () => {
    renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all needing setup" }),
    );
    expect(box("Channel Digest")).toBeChecked();
    expect(box("Slack Feed")).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Save — 2 changes" }),
    ).toBeEnabled();
  });

  it("a dashboard's Select all ticks only its widgets", () => {
    renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all in Daily Brief" }),
    );
    expect(box("Channel Digest")).toBeChecked();
    expect(box("Slack Feed")).not.toBeChecked();
  });

  it("Save is disabled with no changes; saving passes the ticks and shows the summary", async () => {
    const onSave = jest.fn(async () => ({
      widgets: 1,
      removed: 0,
      dashboards: 1,
      bots: 1,
      failed: [{ kind: "dashboard", name: "Kitchen Sink", error: "disk full" }],
    }));
    renderDialog({ onSave });
    expect(
      screen.getByRole("button", { name: "Save — no changes" }),
    ).toBeDisabled();
    fireEvent.click(box("Channel Digest"));
    fireEvent.click(box("Digest"));
    fireEvent.click(screen.getByRole("button", { name: "Save — 2 changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      "w:1:feed": true,
      "b:b1": true,
      "w:1:compose": true,
    });
    await waitFor(() =>
      expect(screen.getByTestId("provider-use-summary")).toHaveTextContent(
        "Slack Dash Comms is now used by 1 more widget on 1 dashboard and 1 bot.",
      ),
    );
    expect(screen.getByTestId("provider-use-failed")).toHaveTextContent(
      "Kitchen Sink (dashboard): disk full",
    );
  });

  it("a widget using this provider only as the default can't be unticked", () => {
    const locked = {
      ...model,
      defaultName: "Slack Dash Comms",
      dashboards: [
        {
          ...model.dashboards[1],
          rows: [
            {
              ...model.dashboards[1].rows[0],
              current: {
                kind: "default",
                name: "Slack Dash Comms",
                needsSetup: false,
              },
              usesThis: true,
              locked: true,
            },
          ],
        },
      ],
    };
    renderDialog({ model: locked });
    expect(box("Slack Feed")).toBeChecked();
    expect(box("Slack Feed")).toBeDisabled();
    expect(screen.getByTestId("now-w:2:k")).toHaveTextContent(
      "now: default — Slack Dash Comms",
    );
  });
});

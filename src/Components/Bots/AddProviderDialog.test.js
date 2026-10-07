/**
 * AddProviderDialog — add a draft's suggested provider without leaving the
 * draft review (bot-capabilities CAP-005): the catalog/custom form in a
 * dialog, saved the same way as Settings › Providers.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AppContext } from "../../Context/App/AppContext";
import { AddProviderDialog } from "./AddProviderDialog";

let lastProps = null;
jest.mock("../Settings/details/McpCatalogDetail", () => ({
  McpCatalogDetail: (props) => {
    lastProps = props;
    return (
      <div data-testid="catalog">
        <button
          onClick={() =>
            props.onSave(
              "Web Fetch (test)",
              "web-fetch",
              { maxImages: "3" },
              { transport: "in_process", builtin: "web-fetch" },
              ["fetch_image"],
            )
          }
        >
          save
        </button>
        <button onClick={props.onCancel}>cancel</button>
      </div>
    );
  },
}));

function renderDialog(request, { fail = false } = {}) {
  const onClose = jest.fn();
  const dashApi = {
    saveProvider: jest.fn((appId, name, payload, ok, err) =>
      fail ? err(null, new Error("disk full")) : ok(null, {}),
    ),
  };
  const refreshProviders = jest.fn();
  render(
    <AppContext.Provider
      value={{
        dashApi,
        credentials: { appId: "app" },
        providers: {},
        refreshProviders,
      }}
    >
      <AddProviderDialog request={request} onClose={onClose} />
    </AppContext.Provider>,
  );
  return { onClose, dashApi, refreshProviders };
}

describe("AddProviderDialog", () => {
  it("opens the catalog at the suggested entry", () => {
    renderDialog({ catalogId: "web-fetch" });
    expect(screen.getByTestId("catalog")).toBeInTheDocument();
    expect(lastProps.initialSelectedId).toBe("web-fetch");
    expect(lastProps.initialCustom).toBe(null);
  });

  it("opens the custom form pre-filled for a community server", () => {
    const custom = {
      name: "StockCake",
      mcpConfig: { transport: "streamable_http", url: "https://x.test" },
      warning: "Unverified",
    };
    renderDialog({ custom });
    expect(lastProps.initialCustom).toEqual(custom);
  });

  it("saves through the shared path, refreshes providers, and closes", async () => {
    const { onClose, dashApi, refreshProviders } = renderDialog({
      catalogId: "web-fetch",
    });
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(dashApi.saveProvider.mock.calls[0][1]).toBe("Web Fetch (test)");
    expect(refreshProviders).toHaveBeenCalled();
  });

  it("shows the error and stays open when saving fails", async () => {
    const { onClose } = renderDialog(
      { catalogId: "web-fetch" },
      { fail: true },
    );
    fireEvent.click(screen.getByText("save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/disk full/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel closes it", () => {
    const { onClose } = renderDialog({ catalogId: "web-fetch" });
    fireEvent.click(screen.getByText("cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing without a request", () => {
    const { container } = render(
      <AddProviderDialog request={null} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * PermissionsTab (Dashboard Config) — restyle slice 2: quiet buttons, and
 * "Revoke all" for the whole dashboard asks first (like the Bots view's
 * Delete) before revoking anything.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { PermissionsTab } from "./PermissionsTab";
import { AppContext } from "../../Context/App/AppContext";

const workspace = {
  id: 7,
  name: "Kitchen Sink",
  layout: [{ id: 1, component: "trops.slack.SlackWidget", dashboardId: 7 }],
};

const row = {
  widgetId: "trops.slack.SlackWidget",
  hasManifest: true,
  declared: { servers: { slack: { tools: ["send_message"] } } },
  granted: { servers: { slack: { tools: ["send_message"] } } },
};

function setup() {
  const api = {
    listAll: jest.fn().mockResolvedValue([row]),
    revoke: jest.fn().mockResolvedValue(true),
    setGrant: jest.fn().mockResolvedValue(true),
  };
  window.mainApi = { widgetMcp: api };
  render(
    <AppContext.Provider value={{ providers: {} }}>
      <PermissionsTab workspace={workspace} />
    </AppContext.Provider>,
  );
  return { api };
}

afterEach(() => {
  delete window.mainApi;
});

describe("PermissionsTab — Revoke all asks first", () => {
  it("shows a confirm; Cancel revokes nothing", async () => {
    const { api } = setup();
    fireEvent.click(
      within(await screen.findByTestId("permissions-revoke-all")).getByRole(
        "button",
      ),
    );
    const confirm = screen.getByTestId("permissions-revoke-all-confirm");
    expect(confirm).toHaveTextContent(
      "Revoke all permissions for this dashboard?",
    );
    expect(api.revoke).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByText("Cancel"));
    expect(screen.queryByTestId("permissions-revoke-all-confirm")).toBeNull();
    expect(api.revoke).not.toHaveBeenCalled();
  });

  it("Revoke in the confirm revokes every granted widget", async () => {
    const { api } = setup();
    fireEvent.click(
      within(await screen.findByTestId("permissions-revoke-all")).getByRole(
        "button",
      ),
    );
    fireEvent.click(
      within(screen.getByTestId("permissions-revoke-all-confirm")).getByText(
        "Revoke",
      ),
    );
    await waitFor(() =>
      expect(api.revoke).toHaveBeenCalledWith("trops.slack.SlackWidget"),
    );
  });
});

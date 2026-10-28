/**
 * Load a v2 profile: the preview (install / update / here / keep /
 * unavailable, providers, keys) and the user's choices sent with the load.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoadProfileV2Modal, leavingText, rowText } from "./LoadProfileV2Modal";

const appId = "@test/app";

const preview = {
  success: true,
  schemaVersion: 2,
  token: "pl_1",
  file: { name: "Mac Mini", owner: "trops", createdOn: "laptop" },
  target: { mode: "create", profileId: null, name: "Mac Mini" },
  fromDefault: false,
  unreachable: false,
  rows: [
    {
      kind: "dashboard",
      package: "@trops/home-lab",
      version: "1.0.3",
      name: "Home Lab",
      action: "update",
      localId: 11,
      reason: "1.0.1 here; the profile has 1.0.3",
    },
    {
      kind: "dashboard",
      package: "@trops/kitchen",
      version: "2.0.0",
      name: "Kitchen",
      action: "keep",
      reason: "This Mac has a newer version",
    },
    {
      kind: "widget",
      package: "@trops/chat",
      version: "0.0.9",
      name: "@trops/chat",
      action: "install",
    },
    {
      kind: "theme",
      package: "@trops/ocean",
      version: "1.1.0",
      name: "Ocean",
      action: "here",
    },
    {
      kind: "bot",
      package: "@trops/brief",
      version: "1.0.1",
      name: "@trops/brief",
      action: "unavailable",
      reason: "Not in the registry any more, or not shared with you.",
    },
    {
      kind: "team",
      package: "@trops/home-lab-team",
      version: "1.0.0",
      name: "@trops/home-lab-team",
      action: "install",
    },
  ],
  providers: [
    { name: "Notion", type: "notion", status: "ready" },
    {
      name: "Work Slack",
      type: "slack",
      status: "map",
      options: ["Slack"],
      mapTo: "Slack",
    },
    {
      name: "Home",
      type: "home-assistant",
      providerClass: "credential",
      status: "setup",
    },
  ],
  secretsToEnter: [
    { dashboard: "Home Lab", widget: "Lights", field: "apiKey" },
  ],
  leftOut: [{ name: "Work", reason: "Imported from a file." }],
  settings: { theme: "Ocean" },
};

function mount(extra = {}, api = {}) {
  window.mainApi = {
    profiles: {
      applyLoad: jest.fn().mockResolvedValue({
        success: true,
        profile: { id: "mac-mini", name: "Mac Mini" },
      }),
      ...api,
    },
  };
  const onLoaded = jest.fn();
  render(
    <LoadProfileV2Modal
      appId={appId}
      preview={{ ...preview, ...extra }}
      onClose={jest.fn()}
      onLoaded={onLoaded}
    />,
  );
  return { onLoaded };
}

afterEach(() => {
  delete window.mainApi;
});

describe("LoadProfileV2Modal", () => {
  test("shows what loading does to each item, providers, keys and what was left out", () => {
    mount();
    expect(screen.getByTestId("load-v2-dashboard")).toHaveTextContent(
      "Dashboards · 2 dashboards",
    );
    expect(screen.getByLabelText("Home Lab — update to 1.0.3")).toBeChecked();
    expect(
      screen.getByLabelText("Kitchen — use the profile's 2.0.0"),
    ).not.toBeChecked();
    expect(screen.getByTestId("load-v2-widget")).toHaveTextContent(
      "@trops/chat 0.0.9 · new",
    );
    expect(screen.getByTestId("load-v2-theme")).toHaveTextContent(
      "1 already here",
    );
    expect(screen.getByTestId("load-v2-bot")).toHaveTextContent(
      "Not in the registry any more",
    );
    expect(screen.getByTestId("load-v2-providers")).toHaveTextContent(
      "Notion · ready on this Mac",
    );
    expect(screen.getByTestId("load-v2-providers")).toHaveTextContent(
      'name it "Home" so the profile\'s dashboards and bots find it',
    );
    expect(screen.getByText(/New bots arrive paused/)).toBeInTheDocument();
    expect(screen.getByTestId("load-v2-secrets")).toHaveTextContent(
      "Home Lab › Lights › apiKey",
    );
    expect(screen.getByTestId("load-v2-left-out")).toHaveTextContent(
      "Work: Imported from a file.",
    );
  });

  test("sends the choices: kept updates, taken items, provider mapping, settings", async () => {
    const { onLoaded } = mount();
    fireEvent.click(screen.getByLabelText("Home Lab — update to 1.0.3"));
    fireEvent.click(screen.getByLabelText("Kitchen — use the profile's 2.0.0"));
    fireEvent.click(
      screen.getByLabelText("Also use its app theme and update setting"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(window.mainApi.profiles.applyLoad).toHaveBeenCalledWith(
      appId,
      "pl_1",
      {
        asNew: false,
        name: "Mac Mini",
        keep: ["dashboard:@trops/home-lab"],
        take: ["dashboard:@trops/kitchen"],
        providerMap: { "Work Slack": "Slack" },
        applySettings: true,
      },
    );
  });

  test("a v3 profile's setup: folders, and the profile's copy of a changed item", async () => {
    const { onLoaded } = mount({
      schemaVersion: 3,
      rows: [
        { kind: "folder", package: "2", name: "House", action: "install" },
        {
          kind: "dashboard",
          package: "1",
          name: "Home",
          action: "update",
          localId: "1",
          reason: "Edited more recently in the profile",
        },
        {
          kind: "bot",
          package: "brief",
          name: "Brief",
          action: "keep",
          localId: "brief",
          reason: "Edited more recently on this Mac",
        },
      ],
    });
    expect(screen.getByTestId("load-v2-folder")).toHaveTextContent(
      "House · new",
    );
    expect(
      screen.getByLabelText("Home — use the profile's copy"),
    ).toBeChecked();
    fireEvent.click(screen.getByLabelText("Brief — use the profile's copy"));
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(window.mainApi.profiles.applyLoad.mock.calls[0][2].take).toEqual([
      "bot:brief",
    ]);
  });

  test("from the account, a changed item says the account's copy", () => {
    mount({
      schemaVersion: 3,
      fromAccount: true,
      rows: [
        {
          kind: "dashboard",
          package: "1",
          name: "Home",
          action: "update",
          localId: "1",
        },
      ],
    });
    expect(
      screen.getByLabelText("Home — use the account's copy"),
    ).toBeChecked();
  });

  test("loading a v3 profile as new says the records are shared", () => {
    mount({
      schemaVersion: 3,
      target: { mode: "replace", profileId: "mm", name: "Mac Mini" },
    });
    expect(screen.queryByTestId("load-as-new-shared")).toBeNull();
    fireEvent.click(screen.getByLabelText("Load as a new profile instead"));
    expect(screen.getByTestId("load-as-new-shared")).toHaveTextContent(
      "a change to one shows in both profiles",
    );
  });

  test("Set up opens the provider form for that type", () => {
    mount();
    const seen = [];
    const listener = (e) => seen.push(e.detail);
    window.addEventListener("dash:open-settings-create-provider", listener);
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    window.removeEventListener("dash:open-settings-create-provider", listener);
    expect(seen).toEqual([
      { type: "home-assistant", providerClass: "credential" },
    ]);
  });

  test("an unreachable registry: said, and nothing loads", () => {
    mount({ unreachable: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Can't reach the registry" }),
    );
    expect(window.mainApi.profiles.applyLoad).not.toHaveBeenCalled();
  });

  test("rowText", () => {
    expect(rowText({ name: "X", version: "1.0.0", action: "install" })).toBe(
      "X 1.0.0 · new",
    );
    expect(rowText({ name: "X", action: "unavailable", reason: "Gone" })).toBe(
      "X · Gone",
    );
  });
});

describe("leavingText", () => {
  it("says what stays in other profiles and what gets hidden", () => {
    expect(leavingText([])).toBeNull();
    expect(
      leavingText([
        { name: "Office", hidden: false },
        { name: "Mailer", hidden: true },
      ]),
    ).toBe(
      "Leaves this profile (still in your other profiles): Office. Not in any other profile, so hidden until you tick it back in Settings › Profiles (it stays on this computer): Mailer.",
    );
  });
});

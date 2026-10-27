/**
 * Load a profile from a file (dash-profiles PR 5): the preview says what
 * changes, the newer copy of a changed item is picked by default, widgets
 * to install are ticked, app settings are opt-in, and replacing can become
 * a new profile instead.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoadProfileModal } from "./LoadProfileModal";

const appId = "@test/app";

const preview = {
  success: true,
  token: "pl_1",
  file: { name: "Mac Mini", createdOn: "Johns-Laptop", createdAt: null },
  target: { mode: "replace", profileId: "p-mini", name: "Mac Mini" },
  fromDefault: false,
  items: {
    dashboards: [
      { id: "101", name: "Home Assistant", state: "same", alsoIn: [] },
      {
        id: "102",
        name: "Kitchen",
        state: "changed",
        useFile: true,
        reason: "Edited more recently in the file",
        alsoIn: ["Default"],
      },
      {
        id: "103",
        name: "Garage",
        state: "changed",
        useFile: false,
        reason: "This Mac has a newer version (1.2.0; 1.1.0 in the file)",
        alsoIn: [],
      },
      { id: "104", name: "Old", state: "leaves", alsoIn: [] },
    ],
    bots: [{ id: "bot_1", name: "Brief", state: "new", alsoIn: [] }],
    folders: [],
    themes: [],
  },
  widgets: [
    {
      package: "@trops/home-assistant",
      version: "2.1.0",
      action: "update",
      on: true,
      reason: "Updates 2.0.0 → 2.1.0",
      dashboardsUsing: 3,
    },
    {
      package: "@ai-built/clock",
      version: "1.0.0",
      action: "choose",
      on: false,
      reason:
        "This Mac has its own build (0.9.0) — kept unless you pick the file's",
    },
    {
      package: "@trops/chat",
      version: "0.0.882",
      action: "same",
      reason: "Already on this Mac",
    },
  ],
  providers: [
    { name: "Home Assistant", type: "home-assistant", ready: false },
    { name: "Slack", type: "slack", ready: true },
  ],
  settings: { theme: "ocean", checkForUpdatesOnLaunch: true },
  secretsToEnter: [
    { dashboard: "Home Assistant", widget: "Lights", field: "accessToken" },
  ],
};

function mount(overrides = {}, p = preview) {
  const applyLoad =
    overrides.applyLoad ||
    jest.fn().mockResolvedValue({
      success: true,
      profile: { id: "p-mini", name: "Mac Mini" },
    });
  window.mainApi = { profiles: { applyLoad } };
  const onLoaded = jest.fn();
  const onClose = jest.fn();
  render(
    <LoadProfileModal
      appId={appId}
      preview={p}
      onClose={onClose}
      onLoaded={onLoaded}
    />,
  );
  return { applyLoad, onLoaded, onClose };
}

afterEach(() => {
  delete window.mainApi;
});

test("replacing: warns, lists what changes, and picks the newer copy", () => {
  mount();
  expect(screen.getByText("Replace Mac Mini?")).toBeInTheDocument();
  expect(
    screen.getByText(/This will replace your "Mac Mini" profile/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/1 already here · 1 leaves this profile/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "Kitchen — use the file's" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Garage — use the file's" }),
  ).not.toBeChecked();
  expect(screen.getByText(/also in Default/)).toBeInTheDocument();
  // "Already here" rows aren't listed one by one.
  expect(screen.queryByText("Home Assistant")).toBeNull();
  expect(screen.getByText(/New bots arrive paused/)).toBeInTheDocument();
  // Keys typed into widgets aren't in the file: listed to enter here.
  expect(screen.getByText("Enter on this Mac")).toBeInTheDocument();
  expect(
    screen.getByText("Home Assistant › Lights › accessToken"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Set these up on this Mac after loading: Home Assistant\./,
    ),
  ).toBeInTheDocument();
});

test("widgets: updates ticked, this Mac's own build not, settings off", () => {
  mount();
  expect(
    screen.getByRole("checkbox", { name: "@trops/home-assistant 2.1.0" }),
  ).toBeChecked();
  expect(screen.getByText(/used by 3 dashboards here/)).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "@ai-built/clock 1.0.0" }),
  ).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: /@trops\/chat/ })).toBeNull();
  expect(
    screen.getByRole("checkbox", {
      name: "Also use its app theme and update setting",
    }),
  ).not.toBeChecked();
});

test("Replace sends the choices, then reports back", async () => {
  const { applyLoad, onLoaded } = mount();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Garage — use the file's" }),
  );
  fireEvent.click(screen.getByText("Replace"));
  await waitFor(() => expect(onLoaded).toHaveBeenCalled());
  expect(applyLoad).toHaveBeenCalledWith(appId, "pl_1", {
    asNew: false,
    name: undefined,
    useFile: {
      dashboards: ["102", "103"],
      bots: [],
      folders: [],
      themes: [],
    },
    widgets: ["@trops/home-assistant"],
    applySettings: false,
  });
});

test("load as a new profile instead asks for a name", async () => {
  const { applyLoad } = mount();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Load as a new profile instead" }),
  );
  expect(screen.getByText("Load Mac Mini")).toBeInTheDocument();
  expect(screen.queryByText(/This will replace/)).toBeNull();
  const field = screen.getByLabelText("Profile name");
  expect(field).toHaveValue("Mac Mini (loaded)");
  fireEvent.change(field, { target: { value: "Mac Mini 2" } });
  fireEvent.click(screen.getByText("Load"));
  await waitFor(() => expect(applyLoad).toHaveBeenCalled());
  expect(applyLoad.mock.calls[0][2]).toMatchObject({
    asNew: true,
    name: "Mac Mini 2",
  });
});

test("a failed load keeps the dialog open with the reason", async () => {
  const { onLoaded } = mount({
    applyLoad: jest
      .fn()
      .mockResolvedValue({ success: false, error: "Open the file again" }),
  });
  fireEvent.click(screen.getByText("Replace"));
  expect(await screen.findByText("Open the file again")).toBeInTheDocument();
  expect(onLoaded).not.toHaveBeenCalled();
});

test("a file of Default loads as its own profile", () => {
  mount(
    {},
    {
      ...preview,
      fromDefault: true,
      target: {
        mode: "create",
        profileId: null,
        name: "Default (from Johns-Laptop)",
      },
    },
  );
  expect(
    screen.getByText(/Your Default profile isn't changed/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Profile name")).toHaveValue(
    "Default (from Johns-Laptop)",
  );
});

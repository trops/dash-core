/**
 * Settings › Profiles (dash-profiles PRD, PR 3): the profiles, which one
 * is active, and what each holds — ticking puts an item in a profile,
 * unticking takes it out of just that one.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProfilesSection } from "./ProfilesSection";
import { AppContext } from "../../../Context/App/AppContext";

// The Save dialog, stood in for: Save at once says what it left out.
jest.mock("./SaveProfileModal", () => {
  const actual = jest.requireActual("./SaveProfileModal");
  return {
    ...actual,
    SaveProfileModal: ({ onSaved }) => (
      <button
        onClick={() =>
          onSaved({
            account: {},
            publishedWidgets: [{}, {}],
            leftOut: [
              {
                kind: "widget",
                name: "@ai-built/pipeline",
                reason:
                  "Not in the registry — Pipeline File will show it as missing on the other computer.",
              },
              {
                kind: "widget",
                name: "Clock_default",
                reason: "Not in the registry.",
              },
            ],
          })
        }
      >
        Stand-in save
      </button>
    ),
  };
});

const appId = "@test/app";

const twoProfiles = {
  success: true,
  activeProfileId: "default",
  profiles: [
    {
      id: "default",
      name: "Default",
      items: { dashboards: ["1", "2"], bots: [], folders: [], themes: [] },
    },
    {
      id: "p-mini",
      name: "Mac Mini",
      items: { dashboards: ["1"], bots: [], folders: [], themes: [] },
    },
  ],
};

const contentsFor = (profileId) => ({
  success: true,
  hasProfiles: true,
  contents: {
    dashboards: [
      {
        id: 1,
        name: "Home Assistant",
        inProfile: true,
        alsoIn: profileId === "default" ? ["Mac Mini"] : ["Default"],
      },
      {
        id: 2,
        name: "Sales",
        inProfile: profileId === "default",
        alsoIn: profileId === "default" ? [] : ["Default"],
      },
    ],
    bots: [],
    folders: [],
    themes: [],
  },
});

function mount(list = twoProfiles, contents = contentsFor) {
  window.mainApi = {
    profiles: {
      list: jest.fn().mockResolvedValue(list),
      listContents: jest.fn((a, id) => Promise.resolve(contents(id))),
      setMembership: jest.fn().mockResolvedValue({ success: true, alsoIn: [] }),
      switch: jest.fn().mockResolvedValue({ success: true }),
      create: jest.fn().mockResolvedValue({
        success: true,
        profile: { id: "p-new", name: "Work" },
      }),
      delete: jest.fn().mockResolvedValue({ success: true }),
    },
    bots: { listRunning: jest.fn().mockResolvedValue([]) },
  };
  const onReload = jest.fn();
  render(
    <AppContext.Provider value={{ credentials: { appId } }}>
      <ProfilesSection onReloadContents={onReload} />
    </AppContext.Provider>,
  );
  return onReload;
}

afterEach(() => {
  delete window.mainApi;
});

test("lists the profiles and marks the active one", async () => {
  mount();
  expect(await screen.findByText("Mac Mini")).toBeInTheDocument();
  expect(screen.getAllByText(/^Active/).length).toBeGreaterThan(0);
});

test("Delete is off for Default and for the active profile", async () => {
  mount();
  await screen.findByText("Home Assistant");
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

  fireEvent.click(screen.getByText("Mac Mini"));
  await waitFor(() =>
    expect(window.mainApi.profiles.listContents).toHaveBeenLastCalledWith(
      appId,
      "p-mini",
    ),
  );
  expect(screen.getByRole("button", { name: "Delete" })).not.toBeDisabled();
});

test("ticks show what the profile holds and where else each item is", async () => {
  mount();
  const ha = await screen.findByRole("checkbox", { name: "Home Assistant" });
  expect(ha).toBeChecked();
  expect(screen.getByText(/also in Mac Mini/)).toBeInTheDocument();
});

test("unticking an item another profile holds takes it out of this one", async () => {
  const onReload = mount();
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Home Assistant" }),
  );
  await waitFor(() =>
    expect(window.mainApi.profiles.setMembership).toHaveBeenCalledWith(
      appId,
      "default",
      "dashboards",
      1,
      false,
    ),
  );
  // The active profile changed: the sidebar and lists refresh.
  await waitFor(() => expect(onReload).toHaveBeenCalled());
});

test("unticking the last profile that holds an item asks first", async () => {
  mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Sales" }));
  expect(await screen.findByTestId("confirmation-modal")).toHaveTextContent(
    "isn't in any other profile",
  );
  expect(window.mainApi.profiles.setMembership).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Take it out"));
  await waitFor(() =>
    expect(window.mainApi.profiles.setMembership).toHaveBeenCalledWith(
      appId,
      "default",
      "dashboards",
      2,
      false,
    ),
  );
});

test("switching asks first when bots are running", async () => {
  mount();
  fireEvent.click(await screen.findByText("Mac Mini"));
  window.mainApi.bots.listRunning.mockResolvedValue([{ id: "b1" }]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Switch to this profile" }),
  );
  expect(await screen.findByTestId("confirmation-modal")).toHaveTextContent(
    "1 bot is running",
  );
  fireEvent.click(screen.getByText("Switch"));
  await waitFor(() =>
    expect(window.mainApi.profiles.switch).toHaveBeenCalledWith(
      appId,
      "p-mini",
    ),
  );
});

test("with only Default, it explains profiles instead of listing ticks", async () => {
  mount(
    {
      success: true,
      activeProfileId: "default",
      profiles: [{ id: "default", name: "Default" }],
    },
    () => ({
      success: true,
      hasProfiles: false,
      contents: { dashboards: [], bots: [], folders: [], themes: [] },
    }),
  );
  expect(
    await screen.findByText(/Default holds everything on this computer/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("New profile creates one and selects it", async () => {
  mount();
  fireEvent.click(await screen.findByText("New profile"));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Work" },
  });
  fireEvent.click(screen.getByText("Create profile"));
  await waitFor(() =>
    expect(window.mainApi.profiles.create).toHaveBeenCalledWith(appId, "Work"),
  );
});

test("after a save, what was left out is one line in the notice, names under Show which", async () => {
  mount();
  fireEvent.click(await screen.findByText("Mac Mini"));
  fireEvent.click(await screen.findByText("Save to my account"));
  fireEvent.click(await screen.findByText("Stand-in save"));
  expect(
    await screen.findByText(
      "Saved to your account. Published 2 widgets first. 2 widgets aren't in the profile — the other computer shows them as missing.",
    ),
  ).toBeInTheDocument();
  // No error box.
  expect(screen.queryByText(/Not in the profile/)).toBeNull();
  const left = screen.getByTestId("profile-left-out");
  expect(left).not.toHaveTextContent("@ai-built/pipeline");
  fireEvent.click(screen.getByRole("button", { name: "Show which" }));
  expect(left).toHaveTextContent(
    "• @ai-built/pipeline — Not in the registry — Pipeline File will show it as missing on the other computer",
  );
  expect(left).toHaveTextContent("• Clock_default — Not in the registry");
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(left).not.toHaveTextContent("@ai-built/pipeline");
});

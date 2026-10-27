/**
 * Save a profile to a file (dash-profiles PR 4): what goes in, where each
 * widget comes from on the other computer, the options, and the save.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveProfileModal, widgetStatusText } from "./SaveProfileModal";

const appId = "@test/app";
const profile = { id: "p-mini", name: "Mac Mini" };

const preview = {
  success: true,
  signedIn: false,
  counts: { dashboards: 1, bots: 1, folders: 1, themes: 1, providers: 2 },
  widgets: [
    {
      package: "@trops/chat",
      version: "0.0.882",
      source: "registry",
      status: "in-registry",
    },
    {
      package: "@ai-built/pipeline",
      version: "0.1.0",
      source: "bundled",
      status: "not-in-registry",
    },
  ],
  bundledBytes: 2048,
};

function mount(overrides = {}) {
  window.mainApi = {
    profiles: {
      previewSave: jest.fn().mockResolvedValue(preview),
      saveFile: jest.fn().mockResolvedValue({
        success: true,
        filePath: "/d/Mac Mini.dashprofile",
      }),
      ...overrides,
    },
  };
  const onSaved = jest.fn();
  const onClose = jest.fn();
  render(
    <SaveProfileModal
      appId={appId}
      profile={profile}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onClose };
}

afterEach(() => {
  delete window.mainApi;
});

test("shows what goes in and where each widget comes from", async () => {
  mount();
  expect(await screen.findByTestId("save-profile-counts")).toHaveTextContent(
    "1 dashboard · 1 bot · 1 folder · 1 theme · 2 providers",
  );
  expect(
    screen.getByText("Downloads automatically when loaded"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Not published — included in this file"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/1 widget will be included in the file \(up to 2 KB\)/),
  ).toBeInTheDocument();
});

test("unticking an option asks for a fresh preview without it", async () => {
  mount();
  await screen.findByTestId("save-profile-counts");
  fireEvent.click(screen.getByRole("checkbox", { name: "Bots" }));
  await waitFor(() =>
    expect(window.mainApi.profiles.previewSave).toHaveBeenLastCalledWith(
      appId,
      "p-mini",
      { bots: false, providers: true, settings: true },
    ),
  );
});

test("Save… saves with the chosen options and reports where", async () => {
  const { onSaved } = mount();
  await screen.findByTestId("save-profile-counts");
  fireEvent.click(screen.getByText("Save…"));
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "/d/Mac Mini.dashprofile" }),
    ),
  );
  expect(window.mainApi.profiles.saveFile).toHaveBeenCalledWith(
    appId,
    "p-mini",
    { bots: true, providers: true, settings: true },
  );
});

test("cancelling the system dialog keeps this one open, quietly", async () => {
  const { onSaved } = mount({
    saveFile: jest.fn().mockResolvedValue({ success: false, canceled: true }),
  });
  await screen.findByTestId("save-profile-counts");
  fireEvent.click(screen.getByText("Save…"));
  await waitFor(() =>
    expect(window.mainApi.profiles.saveFile).toHaveBeenCalled(),
  );
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByText(/Couldn't save/)).toBeNull();
});

test("each widget status reads plainly", () => {
  expect(
    widgetStatusText({
      status: "newer-here",
      registryVersion: "1.3.2",
    }),
  ).toBe("Newer here than the published one (1.3.2) — included in this file");
  expect(widgetStatusText({ status: "local-build" })).toMatch(
    /Installed from a file or folder/,
  );
  expect(widgetStatusText({ status: "unchecked" })).toMatch(
    /Couldn't check right now/,
  );
  expect(
    widgetStatusText({
      status: "in-registry",
      updateAvailable: true,
      registryVersion: "2.0.0",
    }),
  ).toBe(
    "Downloads automatically when loaded · an update (2.0.0) is available",
  );
});

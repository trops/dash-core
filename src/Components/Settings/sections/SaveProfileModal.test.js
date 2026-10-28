/**
 * Save a profile (dash-profiles v3): the review (what the profile holds,
 * widgets in the registry, widgets to check — unpublished changes or not
 * in the registry — with Publish), never publishing on save, and the save.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  SaveProfileModal,
  countsText,
  savedNoticeText,
  leftOutText,
} from "./SaveProfileModal";

const appId = "@test/app";
const profile = { id: "p-mini", name: "Mac Mini" };

const plan = {
  success: true,
  schemaVersion: 3,
  username: "trops",
  counts: {
    dashboards: 2,
    bots: 1,
    themes: 0,
    folders: 1,
    widgets: 2,
    unpublished: 1,
    notInRegistry: 1,
  },
  secretsLeftOut: 1,
  blockers: [],
  widgets: [
    { package: "@trops/chat", version: "0.0.9", action: "listed" },
    {
      package: "@trops/calendar",
      version: "2.0.0",
      here: "2.1.0",
      action: "unpublished",
      note: "You have 2.1.0 here, not published — the profile has 2.0.0.",
    },
    {
      package: "@ai-built/pipeline",
      action: "not-in-registry",
      publishable: true,
      note: "Not in the registry — Home will show it as missing on the other computer. Publish it to include it.",
    },
  ],
};

function mount(overrides = {}, props = {}) {
  window.mainApi = {
    profiles: {
      previewSave: jest.fn().mockResolvedValue(plan),
      saveFile: jest.fn().mockResolvedValue({
        success: true,
        filePath: "/d/Mac Mini.dashprofile",
      }),
      saveToAccount: jest
        .fn()
        .mockResolvedValue({ success: true, account: {} }),
      publishWidget: jest.fn().mockResolvedValue({
        success: true,
        status: "published",
        publishedAs: "@trops/pipeline",
        version: "0.1.0",
      }),
      ...overrides,
    },
    registryAuth: {
      getProfile: jest.fn().mockResolvedValue({ username: "trops" }),
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
      {...props}
    />,
  );
  return { onSaved, onClose };
}

afterEach(() => {
  delete window.mainApi;
});

describe("SaveProfileModal (v3)", () => {
  test("reviews what goes in, and the widgets to check", async () => {
    mount();
    expect(await screen.findByTestId("save-profile-counts")).toHaveTextContent(
      "2 dashboards · 1 bot · 2 widgets",
    );
    const check = screen.getByTestId("save-widgets");
    expect(check).toHaveTextContent("@trops/calendar");
    expect(check).toHaveTextContent("You have 2.1.0 here, not published");
    expect(check).toHaveTextContent("@ai-built/pipeline");
    expect(screen.getByTestId("save-listed")).toHaveTextContent(
      "In the registry: @trops/chat 0.0.9.",
    );
    // Only a widget the user can publish gets the button.
    expect(screen.getAllByRole("button", { name: "Publish" })).toHaveLength(1);
    expect(
      screen.getByText(/1 key typed into a widget isn't included/),
    ).toBeInTheDocument();
  });

  test("saving never publishes", async () => {
    const { onSaved } = mount();
    await screen.findByTestId("save-profile-counts");
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(window.mainApi.profiles.saveFile).toHaveBeenCalledWith(
      appId,
      "p-mini",
      { bots: true, settings: true },
    );
    expect(window.mainApi.profiles.publishWidget).not.toHaveBeenCalled();
  });

  test("Publish publishes that widget, then the review is checked again", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByTestId("save-published")).toHaveTextContent(
      "Published to your account: @trops/pipeline 0.1.0.",
    );
    expect(window.mainApi.profiles.publishWidget).toHaveBeenCalledWith(
      appId,
      "p-mini",
      "@ai-built/pipeline",
      { confirmPersonalPaths: false },
    );
    await waitFor(() =>
      expect(window.mainApi.profiles.previewSave).toHaveBeenCalledTimes(2),
    );
  });

  test("a widget whose files mention this computer's folders is confirmed, then published", async () => {
    const publishWidget = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        status: "needs-confirmation",
        findings: [{ file: "a.js", match: "/Users/me" }],
      })
      .mockResolvedValueOnce({
        success: true,
        publishedAs: "@trops/pipeline",
        version: "0.1.0",
      });
    mount({ publishWidget });
    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByTestId("save-confirm-paths")).toHaveTextContent(
      "a.js: /Users/me",
    );
    fireEvent.click(screen.getByLabelText("Publish anyway"));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByTestId("save-published");
    expect(publishWidget.mock.calls[1][3]).toEqual({
      confirmPersonalPaths: true,
    });
  });

  test("something blocking: listed, and nothing is saved", async () => {
    mount({
      previewSave: jest.fn().mockResolvedValue({
        ...plan,
        blockers: [
          {
            kind: "widget",
            key: "@trops/x",
            name: "@trops/x",
            reason: "Couldn't check @trops/x with the registry — try again.",
          },
        ],
      }),
    });
    expect(await screen.findByTestId("save-blockers")).toHaveTextContent(
      "@trops/x: Couldn't check",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Fix the items above first" }),
    );
    expect(window.mainApi.profiles.saveFile).not.toHaveBeenCalled();
  });

  test("the account needs sign-in; a file doesn't", async () => {
    mount(
      {
        previewSave: jest.fn().mockResolvedValue({ ...plan, username: null }),
      },
      { to: "account" },
    );
    expect(await screen.findByTestId("save-sign-in")).toHaveTextContent(
      "Sign in to the registry to keep this profile in your account.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in first" }));
    expect(window.mainApi.profiles.saveToAccount).not.toHaveBeenCalled();
  });

  test("a newer copy in the account: offers to replace it", async () => {
    mount(
      {
        saveToAccount: jest.fn().mockResolvedValueOnce({
          success: false,
          conflict: { revision: 7, updatedOn: "laptop" },
        }),
      },
      { to: "account" },
    );
    await screen.findByTestId("save-profile-counts");
    fireEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    expect(
      await screen.findByRole("button", { name: "Replace the account's copy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/newer copy of this profile, saved on laptop/),
    ).toBeInTheDocument();
  });

  test("the options change what's planned", async () => {
    mount();
    await screen.findByTestId("save-profile-counts");
    fireEvent.click(screen.getByLabelText("Bots"));
    await waitFor(() =>
      expect(window.mainApi.profiles.previewSave).toHaveBeenLastCalledWith(
        appId,
        "p-mini",
        { bots: false, settings: true },
      ),
    );
  });
});

describe("texts", () => {
  test("countsText", () => {
    expect(countsText({ dashboards: 1, bots: 0, themes: 2, widgets: 3 })).toBe(
      "1 dashboard · 2 themes · 3 widgets",
    );
  });

  test("savedNoticeText and leftOutText", () => {
    expect(
      savedNoticeText({
        filePath: "/Users/me/Desktop/Mac Mini.dashprofile",
        unpublished: [{ package: "@trops/calendar" }],
        secretsLeftOut: 2,
      }),
    ).toBe(
      'Saved "Mac Mini.dashprofile" in Desktop. 1 widget went in at the version you last published. 2 keys typed into widgets aren\'t included.',
    );
    expect(savedNoticeText({ account: {} })).toBe("Saved to your account.");
    expect(
      leftOutText({
        leftOut: [{ name: "@ai-built/x", reason: "Not in the registry." }],
      }),
    ).toBe("Not in the profile: @ai-built/x — Not in the registry.");
    expect(leftOutText({})).toBeNull();
  });
});

/**
 * Save a profile (dash-profiles v2): the review (what's published, what's
 * up to date, what's left out and why, what blocks), the user's public
 * items held back on request, and the save.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  SaveProfileModal,
  publishText,
  savedNoticeText,
  leftOutText,
} from "./SaveProfileModal";

const appId = "@test/app";
const profile = { id: "p-mini", name: "Mac Mini" };

const plan = {
  success: true,
  username: "trops",
  counts: { publish: 3, reference: 2, leaveOut: 1, blocked: 0 },
  secretsLeftOut: 1,
  blockers: [],
  items: [
    {
      kind: "widget",
      key: "@trops/chat",
      name: "@trops/chat",
      action: "reference",
      package: "@trops/chat",
      version: "0.0.9",
    },
    {
      kind: "dashboard",
      key: "1",
      name: "Home Lab",
      action: "reference",
      package: "@trops/home-lab",
      version: "1.0.3",
    },
    {
      kind: "dashboard",
      key: "2",
      name: "Kitchen Sink",
      action: "publish",
      package: "@trops/kitchen-sink",
      version: "1.0.0",
      public: true,
    },
    {
      kind: "dashboard",
      key: "3",
      name: "New One",
      action: "publish",
      package: null,
    },
    {
      kind: "dashboard",
      key: "6",
      name: "Alice Edited",
      action: "remix",
      package: "@alice/edited",
    },
    {
      kind: "dashboard",
      key: "7",
      name: "Carol Edited",
      action: "leave-out",
      reason: "The author of @carol/locked doesn't allow remixes.",
    },
  ],
};

function mount(overrides = {}) {
  window.mainApi = {
    profiles: {
      previewSave: jest.fn().mockResolvedValue(plan),
      saveFile: jest.fn().mockResolvedValue({
        success: true,
        filePath: "/d/Mac Mini.dashprofile",
        published: [],
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
    />,
  );
  return { onSaved, onClose };
}

afterEach(() => {
  delete window.mainApi;
});

describe("SaveProfileModal (v2)", () => {
  test("reviews what's published, up to date, and left out", async () => {
    mount();
    await screen.findByTestId("save-profile-counts");
    expect(screen.getByTestId("save-profile-counts")).toHaveTextContent(
      "3 items to publish · 2 up to date · 1 left out",
    );
    const publish = screen.getByTestId("save-publish");
    expect(publish).toHaveTextContent("Dashboard: Kitchen Sink");
    expect(publish).toHaveTextContent("Dashboard: New One");
    expect(publish).toHaveTextContent(
      "Your remix, published privately (credits @alice/edited)",
    );
    expect(screen.getByTestId("save-referenced")).toHaveTextContent(
      "Up to date in the registry: @trops/chat, Home Lab.",
    );
    expect(screen.getByTestId("save-left-out")).toHaveTextContent(
      "Dashboard Carol Edited: The author of @carol/locked doesn't allow remixes.",
    );
    expect(
      screen.getByText(/1 key typed into a widget isn't included/),
    ).toBeInTheDocument();
  });

  test("a public item is released unless unticked", async () => {
    mount();
    const box = await screen.findByLabelText(
      "Release this as a new public version",
    );
    expect(box).toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await waitFor(() =>
      expect(window.mainApi.profiles.saveFile).toHaveBeenCalledWith(
        appId,
        "p-mini",
        expect.objectContaining({ skipPublic: ["dashboard:2"] }),
      ),
    );
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
            reason: "Checks failed",
          },
        ],
      }),
    });
    expect(await screen.findByTestId("save-blockers")).toHaveTextContent(
      "Widget @trops/x: Checks failed",
    );
    // The button says what's missing.
    fireEvent.click(
      screen.getByRole("button", { name: "Fix the items above first" }),
    );
    expect(window.mainApi.profiles.saveFile).not.toHaveBeenCalled();
  });

  test("signed out: asks to sign in", async () => {
    mount({
      previewSave: jest
        .fn()
        .mockResolvedValue({ success: false, signInRequired: true }),
    });
    expect(await screen.findByTestId("save-sign-in")).toHaveTextContent(
      "Sign in to the registry to save a profile.",
    );
  });

  test("a widget whose files mention this computer's folders is confirmed, then saved", async () => {
    const saveFile = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        needsConfirmation: {
          package: "@ai-built/pipeline",
          findings: [{ file: "a.js", match: "/Users/me" }],
        },
        error: "Check it",
      })
      .mockResolvedValueOnce({ success: true, filePath: "/d/x.dashprofile" });
    const { onSaved } = mount({ saveFile });
    await screen.findByTestId("save-profile-counts");
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(await screen.findByTestId("save-confirm-paths")).toHaveTextContent(
      "a.js: /Users/me",
    );
    fireEvent.click(screen.getByLabelText("Publish anyway"));
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveFile.mock.calls[1][2].confirmPersonalPaths).toEqual([
      "@ai-built/pipeline",
    ]);
  });

  test("the options change what's planned", async () => {
    mount();
    await screen.findByTestId("save-profile-counts");
    fireEvent.click(screen.getByLabelText("Bots"));
    await waitFor(() =>
      expect(window.mainApi.profiles.previewSave).toHaveBeenLastCalledWith(
        appId,
        "p-mini",
        { bots: false, providers: true, settings: true },
      ),
    );
  });
});

describe("texts", () => {
  test("publishText", () => {
    expect(publishText({ action: "publish", package: null })).toBe(
      "New — published privately to your account",
    );
    expect(
      publishText({ action: "publish", package: "@trops/x", public: true }),
    ).toBe("Changed — published as a new version of @trops/x (public)");
  });

  test("savedNoticeText and leftOutText", () => {
    expect(
      savedNoticeText({
        filePath: "/Users/me/Desktop/Mac Mini.dashprofile",
        published: [
          { name: "Home Lab", package: "@trops/home-lab", version: "1.0.4" },
        ],
        secretsLeftOut: 2,
      }),
    ).toBe(
      'Saved "Mac Mini.dashprofile" in Desktop. Published to your account: Home Lab (@trops/home-lab 1.0.4). 2 keys typed into widgets aren\'t included.',
    );
    expect(
      leftOutText({
        leftOut: [{ name: "Work", reason: "Imported from a file." }],
      }),
    ).toBe("Not in the profile: Work — Imported from a file.");
    expect(leftOutText({})).toBeNull();
  });
});

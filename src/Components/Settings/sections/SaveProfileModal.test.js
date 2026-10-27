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

describe("Publish to your account (PR 4b)", () => {
  const signedIn = {
    ...preview,
    signedIn: true,
    username: "trops",
    publishPlan: [
      {
        package: "@ai-built/pipeline",
        publishAs: "@trops/pipeline",
        publishable: true,
        version: "0.1.0",
        currentVersion: "0.1.0",
        visibility: "private",
      },
      {
        package: "@someone/else",
        publishable: false,
        reason: "Published by someone else — it stays in the file",
      },
    ],
  };

  test("nothing is ticked by default; saving publishes nothing", async () => {
    const publishWidget = jest.fn();
    mount({
      previewSave: jest.fn().mockResolvedValue(signedIn),
      publishWidget,
    });
    const box = await screen.findByRole("checkbox", {
      name: "@trops/pipeline 0.1.0",
    });
    expect(box).not.toBeChecked();
    expect(
      screen.getByText("Private — only you can see it"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "@someone/else" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByText("Save…"));
    await waitFor(() =>
      expect(window.mainApi.profiles.saveFile).toHaveBeenCalled(),
    );
    expect(publishWidget).not.toHaveBeenCalled();
  });

  test("a ticked widget is published first, then the file is saved", async () => {
    const order = [];
    const publishWidget = jest.fn(async () => {
      order.push("publish");
      return {
        success: true,
        status: "published",
        publishedAs: "@trops/pipeline",
        version: "0.1.0",
        dashboardsSwitched: 2,
      };
    });
    const saveFile = jest.fn(async () => {
      order.push("save");
      return { success: true, filePath: "/d/x.dashprofile" };
    });
    const { onSaved } = mount({
      previewSave: jest.fn().mockResolvedValue(signedIn),
      publishWidget,
      saveFile,
    });
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "@trops/pipeline 0.1.0" }),
    );
    expect(
      screen.queryByText(/1 widget will be included in the file/),
    ).toBeNull();
    fireEvent.click(screen.getByText("Save…"));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(order).toEqual(["publish", "save"]);
    expect(publishWidget).toHaveBeenCalledWith(
      appId,
      "p-mini",
      "@ai-built/pipeline",
      { confirmPersonalPaths: false },
    );
    // The dialog closes on save, so the outcome goes to the notice.
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saved = onSaved.mock.calls[0][0];
    expect(saved.published).toEqual([
      expect.objectContaining({
        package: "@ai-built/pipeline",
        publishedAs: "@trops/pipeline",
        dashboardsSwitched: 2,
      }),
    ]);
    expect(saved.notPublished).toEqual([]);
  });

  test("personal paths: nothing is saved until the user confirms", async () => {
    const publishWidget = jest
      .fn()
      .mockResolvedValueOnce({
        status: "needs-confirmation",
        findings: [{ file: "widgets/a.js", match: "/Users/john" }],
      })
      .mockResolvedValueOnce({
        success: true,
        status: "published",
        publishedAs: "@trops/pipeline",
        version: "0.1.0",
      });
    mount({
      previewSave: jest.fn().mockResolvedValue(signedIn),
      publishWidget,
    });
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "@trops/pipeline 0.1.0" }),
    );
    fireEvent.click(screen.getByText("Save…"));
    expect(await screen.findByText(/Publish anyway\?/)).toBeInTheDocument();
    expect(window.mainApi.profiles.saveFile).not.toHaveBeenCalled();
    expect(screen.getByText("widgets/a.js: /Users/john")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Publish anyway" }));
    fireEvent.click(screen.getByText("Save…"));
    await waitFor(() =>
      expect(window.mainApi.profiles.saveFile).toHaveBeenCalled(),
    );
    expect(publishWidget).toHaveBeenLastCalledWith(
      appId,
      "p-mini",
      "@ai-built/pipeline",
      { confirmPersonalPaths: true },
    );
  });

  test("a failed publish still saves; the widget stays in the file", async () => {
    const { onSaved } = mount({
      previewSave: jest.fn().mockResolvedValue(signedIn),
      publishWidget: jest
        .fn()
        .mockResolvedValue({ status: "failed", error: "Build failed" }),
    });
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "@trops/pipeline 0.1.0" }),
    );
    fireEvent.click(screen.getByText("Save…"));
    await waitFor(() =>
      expect(window.mainApi.profiles.saveFile).toHaveBeenCalled(),
    );
    // Not lost when the dialog closes: the notice says why.
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0].notPublished).toEqual([
      expect.objectContaining({
        package: "@ai-built/pipeline",
        error: "Build failed",
      }),
    ]);
  });

  test("signed out: suggests signing in instead", async () => {
    mount();
    expect(
      await screen.findByText(/Sign in to publish these to your account/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("save-profile-publish")).toBeNull();
  });
});

/**
 * Save a profile (dash-profiles v3): the review (what the profile holds,
 * widgets in the registry, widgets to publish — unpublished changes or not
 * in the registry), and the save. Bulk publish: the user's own widgets are
 * checked, each with Private/Public, and the one button publishes the
 * checked ones, then saves.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import {
  SaveProfileModal,
  countsText,
  savedNoticeText,
  leftOutSummary,
  leftOutLines,
  widgetStatusText,
  publishedText,
  savedSummaryText,
  warningsText,
  failureText,
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
      published: false,
      visibility: "private",
      dashboards: ["Home"],
      note: "Not in the registry — Home will show it as missing on the other computer. Publish it to include it.",
    },
    {
      package: "@trops/ticker",
      version: "1.0.2",
      here: "1.0.3",
      action: "unpublished",
      publishable: true,
      published: true,
      visibility: "public",
      dashboards: ["Markets"],
      note: "You have 1.0.3 here, not published — the profile has 1.0.2. Publish to include your changes.",
    },
  ],
};

const PIPE = "@ai-built/pipeline";
const TICKER = "@trops/ticker";

// A bulk publish answer: each package's result.
const answer = (byPkg) =>
  jest.fn(async (appId, profileId, pkgs) => ({
    success: true,
    stopped: false,
    results: pkgs.map((p) => ({
      package: p,
      ...(byPkg[p] || {
        status: "published",
        publishedAs: p,
        version: "1.0.0",
        visibility: "private",
      }),
    })),
  }));

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
      publishWidget: answer({}),
      stopPublishing: jest.fn().mockResolvedValue({ success: true }),
      onPublishProgress: jest.fn(() => () => {}),
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
  test("reviews what goes in: your widgets checked, each with Private/Public", async () => {
    mount();
    expect(await screen.findByTestId("save-profile-counts")).toHaveTextContent(
      "2 dashboards · 1 bot · 2 widgets",
    );
    const list = screen.getByTestId("save-widgets");
    expect(list).toHaveTextContent(
      "3 widgets aren't in the registry as they are here",
    );
    // Not the user's: the reason, no checkbox or switch.
    expect(screen.getByTestId("save-widget-@trops/calendar")).toHaveTextContent(
      "You have 2.1.0 here, not published",
    );
    expect(screen.queryByLabelText("@trops/calendar")).toBeNull();
    expect(screen.queryByLabelText("Public: @trops/calendar")).toBeNull();
    // The user's: checked; a first publish private, a published one as it is.
    expect(await screen.findByLabelText(PIPE)).toBeChecked();
    expect(screen.getByLabelText(TICKER)).toBeChecked();
    expect(screen.getByLabelText(`Public: ${PIPE}`)).not.toBeChecked();
    expect(screen.getByLabelText(`Public: ${TICKER}`)).toBeChecked();
    expect(screen.getByTestId(`save-widget-${PIPE}`)).toHaveTextContent(
      "Not in the registry · used by Home",
    );
    expect(screen.getByTestId(`save-widget-${TICKER}`)).toHaveTextContent(
      "Changes here not published · the profile has 1.0.2 · published as public",
    );
    expect(screen.getByTestId("save-bulk-tools")).toHaveTextContent(
      "2 of 2 selected",
    );
    expect(screen.getByTestId("save-listed")).toHaveTextContent(
      "In the registry already: 1 widget.",
    );
    expect(screen.getByTestId("save-what")).toHaveTextContent(
      "Publishes the 2 checked widgets (1 private · 1 public), then saves.",
    );
    expect(
      screen.getByRole("button", { name: "Publish 2 widgets and save…" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 key typed into a widget isn't included/),
    ).toBeInTheDocument();
  });

  test("nothing checked: the plain save, which says what the other computer misses", async () => {
    const { onSaved } = mount();
    await screen.findByLabelText(PIPE);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("save-bulk-tools")).toHaveTextContent(
      "0 of 2 selected",
    );
    expect(
      screen.getByText(
        "Saves without publishing — 3 widgets will show as missing on the other computer.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(window.mainApi.profiles.saveFile).toHaveBeenCalledWith(
      appId,
      "p-mini",
      { bots: true, settings: true },
    );
    expect(window.mainApi.profiles.publishWidget).not.toHaveBeenCalled();
  });

  test("the one button publishes the checked ones with their visibility, then saves", async () => {
    const { onSaved } = mount({}, { to: "account" });
    await screen.findByLabelText(PIPE);
    fireEvent.click(screen.getByLabelText(`Public: ${PIPE}`));
    fireEvent.click(screen.getByLabelText(TICKER));
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 1 widget and save" }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(window.mainApi.profiles.publishWidget).toHaveBeenCalledWith(
      appId,
      "p-mini",
      [PIPE],
      { visibility: { [PIPE]: "public" }, confirmPersonalPaths: [] },
    );
    expect(window.mainApi.profiles.saveToAccount).toHaveBeenCalled();
    // Published first, then saved.
    expect(
      window.mainApi.profiles.publishWidget.mock.invocationCallOrder[0],
    ).toBeLessThan(
      window.mainApi.profiles.saveToAccount.mock.invocationCallOrder[0],
    );
    expect(onSaved.mock.calls[0][0].publishedWidgets).toHaveLength(1);
  });

  test("colors published with a note; a failure is one line, then all its problems", async () => {
    const problems = [
      "Pipeline: line 41: <Modal> isn't allowed in a widget",
      'Pipeline: line 77: emit("done") sends the bare event name',
      "Pipeline: line 90: calls Google Drive directly with fetch",
    ];
    mount(
      {
        publishWidget: answer({
          [PIPE]: {
            status: "failed",
            error: `${PIPE} wasn't published — it didn't pass its checks:\n- ${problems.join("\n- ")}`,
            problems,
          },
          [TICKER]: {
            status: "published",
            publishedAs: TICKER,
            version: "1.0.3",
            warnings: [
              "Ticker: line 3: text-gray-600 is a hard-coded color",
              "Ticker: line 9: bg-gray-100 is a hard-coded color",
            ],
          },
        }),
      },
      { to: "account" },
    );
    await screen.findByLabelText(PIPE);
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 2 widgets and save" }),
    );
    await screen.findByText(/Saved to your account/);
    expect(screen.getByTestId(`save-notes-${TICKER}`)).toHaveTextContent(
      "2 hard-coded colors — it may look off in light mode. Fix them in the Widget Builder.",
    );
    const row = screen.getByTestId(`save-widget-${PIPE}`);
    expect(row).toHaveTextContent(`Didn't publish — ${problems[0]}`);
    expect(row).not.toHaveTextContent("line 77");
    fireEvent.click(
      screen.getByRole("button", { name: "Show all 3 problems" }),
    );
    expect(row).toHaveTextContent("Didn't publish — 3 problems:");
    expect(row).toHaveTextContent("line 77");
    expect(row).toHaveTextContent("line 90");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(row).not.toHaveTextContent("line 77");
  });

  test("all published, some with color notes: the dialog stays open to show them", async () => {
    const { onSaved } = mount(
      {
        publishWidget: answer({
          [TICKER]: {
            status: "published",
            publishedAs: TICKER,
            version: "1.0.3",
            visibility: "public",
            warnings: ["Ticker: line 3: text-gray-600 is a hard-coded color"],
          },
        }),
      },
      { to: "account" },
    );
    await screen.findByLabelText(PIPE);
    // The plan after the save: both are in the registry now.
    window.mainApi.profiles.previewSave.mockResolvedValue({
      ...plan,
      widgets: plan.widgets.map((w) =>
        w.publishable ? { package: w.package, action: "listed" } : w,
      ),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 2 widgets and save" }),
    );
    await screen.findByText(/Saved to your account/);
    expect(onSaved).not.toHaveBeenCalled();
    const notes = await screen.findByTestId(`save-notes-${TICKER}`);
    expect(notes).toHaveTextContent(
      "1 hard-coded color — it may look off in light mode. Fix it in the Widget Builder.",
    );
    expect(screen.getByTestId(`save-widget-${TICKER}`)).toHaveTextContent(
      `✓ ${TICKER}Published as ${TICKER} 1.0.3 · public`,
    );
    expect(screen.queryByTestId(`save-notes-${PIPE}`)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSaved).toHaveBeenCalled();
  });

  test("Set all, then Select all", async () => {
    mount();
    await screen.findByLabelText(PIPE);
    fireEvent.click(screen.getByRole("button", { name: "Set all public" }));
    expect(screen.getByLabelText(`Public: ${PIPE}`)).toBeChecked();
    expect(screen.getByTestId("save-what")).toHaveTextContent(
      "Publishes the 2 checked widgets (2 public), then saves.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Set all private" }));
    expect(screen.getByLabelText(`Public: ${TICKER}`)).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByLabelText(PIPE)).toBeChecked();
    expect(screen.getByLabelText(TICKER)).toBeChecked();
  });

  test("what didn't publish stays checked; saved, the dialog stays open to try again", async () => {
    const publishWidget = answer({
      [TICKER]: { status: "failed", error: "the registry refused it: taken" },
    });
    const { onSaved } = mount({ publishWidget }, { to: "account" });
    await screen.findByLabelText(PIPE);
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 2 widgets and save" }),
    );
    expect(
      await screen.findByText(
        "Saved to your account, with the 1 widget just published.",
      ),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId("save-widgets")).toHaveTextContent(
      "1 published · 1 didn't — it still shows as missing on the other computer.",
    );
    expect(screen.getByTestId(`save-widget-${TICKER}`)).toHaveTextContent(
      "Didn't publish — the registry refused it: taken",
    );
    expect(screen.getByLabelText(TICKER)).toBeChecked();
    expect(screen.getByTestId("save-published")).toHaveTextContent(
      `Published: ${PIPE} 1.0.0 private.`,
    );
    // Try again: only what's left.
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 1 widget and save" }),
    );
    await waitFor(() => expect(publishWidget).toHaveBeenCalledTimes(2));
    expect(publishWidget.mock.calls[1][2]).toEqual([TICKER]);
    // Close hands over the save.
    await waitFor(() =>
      expect(window.mainApi.profiles.saveToAccount).toHaveBeenCalledTimes(2),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSaved).toHaveBeenCalled();
  });

  test("files that mention this computer's folders: gathered, then Publish anyway", async () => {
    const publishWidget = answer({
      [PIPE]: {
        status: "needs-confirmation",
        findings: [{ file: "a.js", match: "/Users/me" }],
      },
    });
    mount({ publishWidget }, { to: "account" });
    await screen.findByLabelText(PIPE);
    fireEvent.click(screen.getByLabelText(TICKER));
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 1 widget and save" }),
    );
    const look = await screen.findByTestId("save-confirm-paths");
    expect(look).toHaveTextContent(
      "1 widget mentions folders on this computer",
    );
    expect(look).toHaveTextContent("a.js: /Users/me");
    // Nothing more to publish until it's ticked.
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Publish anyway"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish 1 widget and save" }),
    );
    await waitFor(() => expect(publishWidget).toHaveBeenCalledTimes(2));
    expect(publishWidget.mock.calls[1][3]).toEqual({
      visibility: { [PIPE]: "private" },
      confirmPersonalPaths: [PIPE],
    });
  });

  test("publishing: which one, how far, and Stop", async () => {
    let progress;
    let finish;
    mount({
      onPublishProgress: jest.fn((cb) => {
        progress = cb;
        return () => {};
      }),
      publishWidget: jest.fn(() => new Promise((r) => (finish = r))),
    });
    await screen.findByLabelText(PIPE);
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 2 widgets and save…" }),
    );
    await waitFor(() => expect(progress).toBeDefined());
    act(() =>
      progress({ package: TICKER, index: 1, total: 2, status: "publishing" }),
    );
    expect(screen.getByTestId("save-run")).toHaveTextContent(
      `Publishing 2 of 2 — ${TICKER} · then saving`,
    );
    expect(
      screen.getByRole("button", { name: "Publishing…" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(window.mainApi.profiles.stopPublishing).toHaveBeenCalledWith(
      appId,
      "p-mini",
    );
    await act(async () =>
      finish({
        success: true,
        stopped: true,
        results: [{ package: PIPE, status: "published", version: "1.0.0" }],
      }),
    );
    // Saved with what's published; the rest stays checked.
    await waitFor(() =>
      expect(window.mainApi.profiles.saveFile).toHaveBeenCalled(),
    );
    expect(await screen.findByLabelText(TICKER)).toBeChecked();
  });

  test("a widget offered later (after signing in, or new options) starts checked too", async () => {
    const previewSave = jest
      .fn()
      .mockResolvedValueOnce({ ...plan, widgets: [plan.widgets[0]] })
      .mockResolvedValue(plan);
    mount({ previewSave });
    await screen.findByTestId("save-all-listed");
    fireEvent.click(screen.getByLabelText("Bots"));
    expect(await screen.findByLabelText(PIPE)).toBeChecked();
    expect(screen.getByLabelText(TICKER)).toBeChecked();
  });

  test("the whole publish fails: every row says why, and nothing is saved", async () => {
    const publishWidget = jest.fn().mockResolvedValue({
      success: false,
      error: "Sign in to publish to your account.",
    });
    mount({ publishWidget });
    await screen.findByLabelText(PIPE);
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 2 widgets and save…" }),
    );
    expect(await screen.findByTestId(`save-widget-${PIPE}`)).toHaveTextContent(
      "Didn't publish — Sign in to publish to your account.",
    );
    await waitFor(() => expect(screen.getByLabelText(PIPE)).toBeChecked());
    expect(window.mainApi.profiles.saveFile).not.toHaveBeenCalled();
  });

  test("only widgets to look at are left: no all-in-the-registry line, and the summary", async () => {
    const onlyPipe = { ...plan, widgets: [plan.widgets[0], plan.widgets[2]] };
    const publishWidget = answer({
      [PIPE]: {
        status: "needs-confirmation",
        findings: [{ file: "a.js", match: "/Users/me" }],
      },
    });
    mount(
      { previewSave: jest.fn().mockResolvedValue(onlyPipe), publishWidget },
      { to: "account" },
    );
    await screen.findByLabelText(PIPE);
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 1 widget and save" }),
    );
    await screen.findByTestId("save-confirm-paths");
    expect(screen.queryByTestId("save-all-listed")).toBeNull();
    expect(await screen.findByTestId("save-summary")).toHaveTextContent(
      "1 needs a look — it still shows as missing on the other computer.",
    );
  });

  test("published but not installed here: counted as published, not tried again", async () => {
    const publishWidget = answer({
      [PIPE]: {
        status: "failed",
        published: true,
        publishedAs: "@trops/pipeline",
        version: "1.0.0",
        error: "Published, but installing it here failed: network.",
      },
      [TICKER]: { status: "failed", error: "boom" },
    });
    mount({ publishWidget }, { to: "account" });
    await screen.findByLabelText(PIPE);
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 2 widgets and save" }),
    );
    expect(await screen.findByTestId("save-summary")).toHaveTextContent(
      "1 published · 1 didn't",
    );
    expect(screen.getByLabelText(PIPE)).not.toBeChecked();
    expect(screen.getByTestId(`save-widget-${PIPE}`)).toHaveTextContent(
      "Published as @trops/pipeline 1.0.0 — Published, but installing it here failed",
    );
    expect(
      screen.getByRole("button", { name: "Publish 1 widget and save" }),
    ).toBeInTheDocument();
  });

  test("replacing the account's newer copy: the button says so", async () => {
    mount({}, { to: "account", replaceRevision: 7 });
    await screen.findByLabelText(PIPE);
    expect(
      screen.getByRole("button", {
        name: "Publish 2 widgets and replace the account's copy",
      }),
    ).toBeInTheDocument();
  });

  test("every widget in the registry: says so, and the plain save", async () => {
    mount({
      previewSave: jest.fn().mockResolvedValue({
        ...plan,
        widgets: [plan.widgets[0]],
      }),
    });
    expect(await screen.findByTestId("save-all-listed")).toHaveTextContent(
      "Every widget is in the registry as it is here",
    );
    expect(screen.getByRole("button", { name: "Save…" })).toBeInTheDocument();
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
    await screen.findByLabelText(PIPE);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
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

describe("check texts", () => {
  test("warningsText counts hard-coded colors and other notes", () => {
    expect(warningsText([])).toBeNull();
    expect(warningsText(["X: line 1: red is a hard-coded color"])).toBe(
      "1 hard-coded color — it may look off in light mode. Fix it in the Widget Builder.",
    );
    expect(warningsText(["X: something else", "Y: another"])).toBe(
      "2 notes from the checks.",
    );
  });
  test("failureText: the first problem, the count when open, else the error", () => {
    const out = { problems: ["a", "b"], error: "long" };
    expect(failureText(out)).toBe("Didn't publish — a");
    expect(failureText(out, true)).toBe("Didn't publish — 2 problems:");
    expect(failureText({ problems: ["only"] }, true)).toBe(
      "Didn't publish — only",
    );
    expect(failureText({ error: "signed out" })).toBe(
      "Didn't publish — signed out",
    );
    expect(failureText({})).toBe("Didn't publish — the registry refused it");
  });
});

describe("texts", () => {
  test("countsText", () => {
    expect(countsText({ dashboards: 1, bots: 0, themes: 2, widgets: 3 })).toBe(
      "1 dashboard · 2 themes · 3 widgets",
    );
  });

  test("savedNoticeText, leftOutSummary and leftOutLines", () => {
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
    const one = {
      leftOut: [
        { kind: "widget", name: "@ai-built/x", reason: "Not in the registry." },
      ],
    };
    expect(leftOutSummary(one)).toBe(
      "1 widget isn't in the profile — the other computer shows it as missing.",
    );
    expect(leftOutLines(one)).toEqual(["@ai-built/x — Not in the registry"]);
    expect(
      leftOutSummary({
        leftOut: [
          { kind: "widget", name: "a" },
          { kind: "theme", name: "b" },
        ],
      }),
    ).toBe("2 items aren't in the profile.");
    expect(leftOutSummary({})).toBeNull();
    expect(savedNoticeText({ account: {}, publishedWidgets: [{}, {}] })).toBe(
      "Saved to your account. Published 2 widgets first.",
    );
  });

  test("savedSummaryText", () => {
    expect(savedSummaryText({ published: 9, failed: 1, needsLook: 2 })).toBe(
      "9 published · 1 didn't · 2 need a look — these still show as missing on the other computer.",
    );
    expect(savedSummaryText({ notYet: 3 })).toBe(
      "3 not published yet — these still show as missing on the other computer.",
    );
    expect(savedSummaryText({ published: 2 })).toBe("2 published.");
  });

  test("widgetStatusText and publishedText", () => {
    expect(widgetStatusText(plan.widgets[2])).toBe(
      "Not in the registry · used by Home",
    );
    expect(widgetStatusText({ ...plan.widgets[2], dashboards: [] })).toBe(
      "Not in the registry · not on a dashboard",
    );
    expect(widgetStatusText(plan.widgets[1])).toBe(plan.widgets[1].note);
    const many = Array.from({ length: 7 }, (_, n) => ({
      package: `@me/w${n}`,
      version: "1.0.0",
      visibility: n === 0 ? "public" : "private",
    }));
    expect(publishedText(many)).toBe(
      "Published: @me/w0 1.0.0 public, @me/w1 1.0.0 private, @me/w2 1.0.0 private, @me/w3 1.0.0 private, @me/w4 1.0.0 private and 2 more.",
    );
  });
});

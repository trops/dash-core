/**
 * @jest-environment jsdom
 *
 * useWidgetUpdates — Phase: Update-all-widgets modal additions.
 *
 * Pins the new `packagesWithUpdates` derivation + `updatePackages`
 * sequential orchestration so a refactor that drops either silently
 * breaks the modal's data source / button wiring without warning.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useWidgetUpdates } from "./useWidgetUpdates";

function installMainApi({ checkUpdates, install, getProfile } = {}) {
  window.mainApi = {
    registry: {
      checkUpdates: checkUpdates || jest.fn().mockResolvedValue([]),
    },
    registryAuth: {
      getProfile:
        getProfile || jest.fn().mockResolvedValue({ id: "test-user" }),
    },
    widgets: {
      install: install || jest.fn().mockResolvedValue({ ok: true }),
    },
  };
}

afterEach(() => {
  delete window.mainApi;
});

const sampleInstalled = [
  {
    name: "SlackListChannels",
    packageId: "@trops/slack",
    source: "installed",
    version: "0.0.700",
  },
  {
    name: "SlackChannelMessages",
    packageId: "@trops/slack",
    source: "installed",
    version: "0.0.700",
  },
  {
    name: "GmailUnreadCount",
    packageId: "@trops/gmail",
    source: "installed",
    version: "0.0.710",
  },
  {
    name: "ChatBuiltin",
    source: "builtin", // should be skipped — only `installed` source has updates
    version: "0.0.1",
  },
];

const sampleUpdates = [
  {
    name: "@trops/slack",
    currentVersion: "0.0.700",
    latestVersion: "0.0.735",
    downloadUrl: "https://registry.example/{name}-{version}.zip",
  },
  {
    name: "@trops/gmail",
    currentVersion: "0.0.710",
    latestVersion: "0.0.735",
    downloadUrl: "https://registry.example/{name}-{version}.zip",
  },
];

describe("useWidgetUpdates — packagesWithUpdates derivation", () => {
  test("dedupes by package id and attaches the widget names that ride along", async () => {
    installMainApi({
      checkUpdates: jest.fn().mockResolvedValue(sampleUpdates),
    });
    const { result } = renderHook(() =>
      useWidgetUpdates(sampleInstalled, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(2);
    });
    const slack = result.current.packagesWithUpdates.find(
      (p) => p.name === "@trops/slack",
    );
    expect(slack).toBeTruthy();
    expect(slack.currentVersion).toBe("0.0.700");
    expect(slack.latestVersion).toBe("0.0.735");
    expect(slack.widgetNames.sort()).toEqual([
      "SlackChannelMessages",
      "SlackListChannels",
    ]);
    const gmail = result.current.packagesWithUpdates.find(
      (p) => p.name === "@trops/gmail",
    );
    expect(gmail.widgetNames).toEqual(["GmailUnreadCount"]);
  });

  test("returns sorted-by-name so the modal renders deterministically", async () => {
    installMainApi({
      checkUpdates: jest.fn().mockResolvedValue(sampleUpdates),
    });
    const { result } = renderHook(() =>
      useWidgetUpdates(sampleInstalled, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(2);
    });
    const names = result.current.packagesWithUpdates.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  test("returns [] when no updates have been fetched yet", () => {
    installMainApi();
    const { result } = renderHook(() => useWidgetUpdates([], jest.fn()));
    expect(result.current.packagesWithUpdates).toEqual([]);
  });
});

describe("useWidgetUpdates — updatePackages batch orchestration", () => {
  test("runs sequentially: in-progress fires BEFORE the per-install await resolves", async () => {
    // Per-call resolver pattern (see seeding test) — single shared
    // resolveInstall deadlocks sequential batches.
    const resolvers = [];
    const install = jest.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolvers.push(r);
        }),
    );
    installMainApi({
      checkUpdates: jest.fn().mockResolvedValue(sampleUpdates),
      install,
    });
    const { result } = renderHook(() =>
      useWidgetUpdates(sampleInstalled, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(2);
    });

    // Fire updatePackages but don't await it — we want to inspect
    // mid-flight state.
    let updateAllPromise;
    act(() => {
      updateAllPromise = result.current.updatePackages([
        "@trops/slack",
        "@trops/gmail",
      ]);
    });

    // First package should flip to in-progress; second still pending.
    await waitFor(() => {
      expect(result.current.batchStatus.get("@trops/slack")?.status).toBe(
        "in-progress",
      );
    });
    expect(result.current.batchStatus.get("@trops/gmail")?.status).toBe(
      "pending",
    );
    expect(result.current.isBatchUpdating).toBe(true);

    // Drain sequentially.
    await act(async () => {
      while (resolvers.length < 1) {
        await new Promise((r) => setTimeout(r, 0));
      }
      resolvers[0]({ ok: true });
      while (resolvers.length < 2) {
        await new Promise((r) => setTimeout(r, 0));
      }
      resolvers[1]({ ok: true });
      await updateAllPromise;
    });

    expect(install).toHaveBeenCalledTimes(2);
    expect(result.current.batchStatus.get("@trops/slack")?.status).toBe("done");
    expect(result.current.batchStatus.get("@trops/gmail")?.status).toBe("done");
    expect(result.current.isBatchUpdating).toBe(false);
  });

  test("a single failed install does not abort the whole batch", async () => {
    let callCount = 0;
    const install = jest.fn().mockImplementation(() => {
      callCount += 1;
      // First call fails; second succeeds.
      if (callCount === 1) {
        return Promise.reject(new Error("network blip"));
      }
      return Promise.resolve({ ok: true });
    });
    installMainApi({
      checkUpdates: jest.fn().mockResolvedValue(sampleUpdates),
      install,
    });
    const { result } = renderHook(() =>
      useWidgetUpdates(sampleInstalled, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(2);
    });

    let summary;
    await act(async () => {
      summary = await result.current.updatePackages([
        "@trops/slack",
        "@trops/gmail",
      ]);
    });

    expect(install).toHaveBeenCalledTimes(2);
    expect(summary.succeeded).toContain("@trops/gmail");
    expect(summary.failed).toContain("@trops/slack");
    expect(result.current.batchStatus.get("@trops/slack")).toMatchObject({
      status: "failed",
      error: "network blip",
    });
    expect(result.current.batchStatus.get("@trops/gmail")?.status).toBe("done");
  });

  test("post-batch re-check clears the updates Map when registry confirms everything's up to date", async () => {
    // After the batch installs, the registry should report no
    // outstanding updates — the re-check then clears `updates` so
    // the "Updates Available" CTA hides. Previously we relied on
    // per-package setUpdates merges (which were brittle); now we
    // belt-and-suspenders the post-batch run with a fresh check.
    //
    // Stage the checkUpdates mock to return the updates the FIRST
    // time (initial check) and an empty array the SECOND time
    // (post-batch re-check).
    let checkCallCount = 0;
    const checkUpdates = jest.fn().mockImplementation(() => {
      checkCallCount += 1;
      if (checkCallCount === 1) return Promise.resolve(sampleUpdates);
      return Promise.resolve([]);
    });
    installMainApi({
      checkUpdates,
      install: jest.fn().mockResolvedValue({ ok: true }),
    });
    const { result } = renderHook(() =>
      useWidgetUpdates(sampleInstalled, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(2);
    });

    await act(async () => {
      await result.current.updatePackages(["@trops/slack", "@trops/gmail"]);
    });

    // The re-check fires after the batch; updates should be empty
    // and the derived packagesWithUpdates list should reflect that.
    await waitFor(() => {
      expect(result.current.packagesWithUpdates).toEqual([]);
    });
    expect(checkUpdates).toHaveBeenCalledTimes(2);
  });

  test("post-batch re-check ALSO clears stale entries when a previous check returned 0 updates", async () => {
    // Edge case: if a prior check populated `updates` with N
    // entries and the user re-installed everything externally, a
    // subsequent re-check that returns [] must reset the Map
    // (not leave the stale N entries). Without the explicit
    // `setUpdates(new Map())` in the empty-results branch, the CTA
    // would persist.
    let checkCallCount = 0;
    const checkUpdates = jest.fn().mockImplementation(() => {
      checkCallCount += 1;
      if (checkCallCount === 1) return Promise.resolve(sampleUpdates);
      return Promise.resolve([]);
    });
    installMainApi({
      checkUpdates,
      install: jest.fn().mockResolvedValue({ ok: true }),
    });
    const { result } = renderHook(() =>
      useWidgetUpdates(sampleInstalled, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(2);
    });

    await act(async () => {
      await result.current.updatePackages(["@trops/slack", "@trops/gmail"]);
    });

    expect(result.current.packagesWithUpdates).toEqual([]);
    // Per-widget badges would also disappear since the Map is empty.
    expect(result.current.updates.size).toBe(0);
  });

  test("called with [] or non-array returns immediately with empty summary", async () => {
    installMainApi();
    const { result } = renderHook(() => useWidgetUpdates([], jest.fn()));
    let summary;
    await act(async () => {
      summary = await result.current.updatePackages([]);
    });
    expect(summary).toEqual({ succeeded: [], failed: [] });
    expect(result.current.isBatchUpdating).toBe(false);

    await act(async () => {
      summary = await result.current.updatePackages(null);
    });
    expect(summary).toEqual({ succeeded: [], failed: [] });
  });

  test("seeds every selected package as 'pending' before the first install fires", async () => {
    // Each install call captures its own resolver — a sequential batch
    // would deadlock if we held a single `resolveInstall` that gets
    // overwritten by the second call before the first one settles.
    const resolvers = [];
    const install = jest.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolvers.push(r);
        }),
    );
    installMainApi({
      checkUpdates: jest.fn().mockResolvedValue(sampleUpdates),
      install,
    });
    const { result } = renderHook(() =>
      useWidgetUpdates(sampleInstalled, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(2);
    });

    let updatePromise;
    act(() => {
      updatePromise = result.current.updatePackages([
        "@trops/slack",
        "@trops/gmail",
      ]);
    });

    // Before the first install resolves, BOTH should be keyed in
    // batchStatus (one in-progress, one still pending). The seed
    // pass should have populated everything up front.
    await waitFor(() => {
      expect(result.current.batchStatus.size).toBe(2);
    });
    expect(result.current.batchStatus.has("@trops/slack")).toBe(true);
    expect(result.current.batchStatus.has("@trops/gmail")).toBe(true);

    // Drain the queue — resolve installs in the order they fire.
    await act(async () => {
      while (resolvers.length < 1) {
        await new Promise((r) => setTimeout(r, 0));
      }
      resolvers[0]({ ok: true });
      while (resolvers.length < 2) {
        await new Promise((r) => setTimeout(r, 0));
      }
      resolvers[1]({ ok: true });
      await updatePromise;
    });
  });
});

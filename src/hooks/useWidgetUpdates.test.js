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
import {
  useWidgetUpdates,
  diffMcpServers,
  mergeMcpGrants,
} from "./useWidgetUpdates";

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

  test("batch path surfaces stale-auth as a failed row (instead of silently marking 'done')", async () => {
    // Reproduces the bug where a user with an expired registry token
    // clicks Update all, sees every package report '✓ done', reloads
    // the app, and finds nothing was actually installed. Root cause:
    // updateWidget returned without throwing when getProfile() came
    // back null. With throwOnError=true the batch caller now sees an
    // exception and marks the row failed, surfacing the auth
    // requirement instead of swallowing it.
    installMainApi({
      checkUpdates: jest.fn().mockResolvedValue(sampleUpdates),
      getProfile: jest.fn().mockResolvedValue(null),
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
    expect(summary.succeeded).toEqual([]);
    expect(summary.failed).toEqual(["@trops/slack", "@trops/gmail"]);
    expect(result.current.batchStatus.get("@trops/slack")).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/Authentication/i),
    });
    // The Map stays populated because nothing was actually installed
    // — user retries after signing back in.
    expect(result.current.packagesWithUpdates.length).toBe(2);
    // needsAuth flips true so RegistryAuthModal can pop where wired.
    expect(result.current.needsAuth).toBe(true);
  });

  test("post-batch authoritative clear drops every succeeded package by id (resilient to mid-loop setState merges)", async () => {
    // Even if per-package setUpdates merges go sideways during a
    // sequential batch, the post-loop authoritative pass operates on
    // the final committed state and clears succeeded entries by id
    // (no closure-staleness, no reliance on val.name matching info.name
    // across many fires). This test confirms the Map is empty after
    // a fully-successful batch.
    installMainApi({
      checkUpdates: jest.fn().mockResolvedValue(sampleUpdates),
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
    expect(result.current.updates.size).toBe(0);
    expect(result.current.packagesWithUpdates).toEqual([]);
  });

  test("failed packages stay in the Map (so the user can retry just those)", async () => {
    // Mid-batch failure: install rejects for @trops/slack but
    // succeeds for @trops/gmail. The authoritative clear pass only
    // touches succeeded ids — slack stays in the Map so its
    // "Update" badge + the trigger button remain visible.
    let callCount = 0;
    const install = jest.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.reject(new Error("network blip"));
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
    await act(async () => {
      await result.current.updatePackages(["@trops/slack", "@trops/gmail"]);
    });
    // gmail succeeded → cleared. slack failed → still in Map.
    expect(
      result.current.packagesWithUpdates.map((p) => p.name).sort(),
    ).toEqual(["@trops/slack"]);
  });

  test("per-package setUpdates clears each entry as its install succeeds (no post-batch re-check needed)", async () => {
    // After a fully-successful batch, the updates Map should be
    // empty — driven by each updateWidget's setUpdates cleanup
    // (one per package). We do NOT post-batch re-check via the
    // registry because closure-captured installedWidgets still
    // carries pre-install versions (refresh() updates the prop
    // asynchronously); a re-check would re-detect the same
    // packages and revive the "Updates Available" CTA.
    const checkUpdates = jest.fn().mockResolvedValue(sampleUpdates);
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

    // Map drained via per-package setUpdates inside updateWidget.
    expect(result.current.packagesWithUpdates).toEqual([]);
    expect(result.current.updates.size).toBe(0);
    // checkUpdates is called ONCE at mount, NOT again post-batch.
    expect(checkUpdates).toHaveBeenCalledTimes(1);
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

describe("preflight helpers — diffMcpServers + mergeMcpGrants", () => {
  test("diffMcpServers: empty out when granted covers everything declared", () => {
    const declared = {
      slack: { tools: ["list_channels"], readPaths: [], writePaths: [] },
    };
    const granted = {
      slack: { tools: ["list_channels"], readPaths: [], writePaths: [] },
    };
    expect(diffMcpServers(declared, granted)).toEqual({});
  });

  test("diffMcpServers: surfaces only the NEW lines, not previously-granted ones", () => {
    const declared = {
      slack: {
        tools: ["list_channels", "send_message"],
        readPaths: ["/inbox"],
        writePaths: [],
      },
    };
    const granted = {
      slack: { tools: ["list_channels"], readPaths: [], writePaths: [] },
    };
    expect(diffMcpServers(declared, granted)).toEqual({
      slack: {
        tools: ["send_message"],
        readPaths: ["/inbox"],
        writePaths: [],
      },
    });
  });

  test("diffMcpServers: a newly-introduced server shows up as fully missing", () => {
    const declared = {
      slack: { tools: ["x"] },
      gmail: { tools: ["send"], readPaths: ["/inbox"] },
    };
    const granted = { slack: { tools: ["x"] } };
    const out = diffMcpServers(declared, granted);
    expect(out.slack).toBeUndefined();
    expect(out.gmail).toEqual({
      tools: ["send"],
      readPaths: ["/inbox"],
      writePaths: [],
    });
  });

  test("mergeMcpGrants: addition unions in, existing items preserved", () => {
    const existing = {
      grantOrigin: "declared",
      servers: {
        slack: { tools: ["list_channels"], readPaths: [], writePaths: [] },
      },
    };
    const addition = {
      servers: {
        slack: { tools: ["send_message"], readPaths: [], writePaths: [] },
        gmail: { tools: ["search"], readPaths: ["/inbox"], writePaths: [] },
      },
    };
    const merged = mergeMcpGrants(existing, addition);
    expect(merged.servers.slack.tools.sort()).toEqual([
      "list_channels",
      "send_message",
    ]);
    expect(merged.servers.gmail).toEqual({
      tools: ["search"],
      readPaths: ["/inbox"],
      writePaths: [],
    });
  });

  test("mergeMcpGrants: addition with no existing produces a clean grant", () => {
    const merged = mergeMcpGrants(null, {
      servers: { slack: { tools: ["x"] } },
    });
    expect(merged.servers.slack.tools).toEqual(["x"]);
    expect(merged.grantOrigin).toBe("declared");
  });
});

describe("updatePackages — pre-install MCP preflight", () => {
  function installMainApiForPreflight({
    manifest,
    listAll,
    install,
    setGrant,
  } = {}) {
    window.mainApi = {
      registry: {
        checkUpdates: jest.fn().mockResolvedValue([
          {
            name: "@trops/slack",
            currentVersion: "0.0.700",
            latestVersion: "0.0.735",
            downloadUrl: "https://reg.example/{name}-{version}.zip",
          },
        ]),
        fetchPackageManifest:
          manifest ||
          jest.fn().mockResolvedValue({
            packageId: "@trops/slack",
            version: "0.0.735",
            permissions: {
              mcp: {
                slack: {
                  tools: ["list_channels", "send_message"],
                  readPaths: [],
                  writePaths: [],
                },
              },
            },
          }),
      },
      registryAuth: {
        getProfile: jest.fn().mockResolvedValue({ id: "user-1" }),
      },
      widgets: {
        install: install || jest.fn().mockResolvedValue({ ok: true }),
      },
      widgetMcp: {
        listAll:
          listAll ||
          jest.fn().mockResolvedValue([
            {
              widgetId: "trops.slack.SlackListChannels",
              declared: {
                servers: {
                  slack: {
                    tools: ["list_channels"],
                    readPaths: [],
                    writePaths: [],
                  },
                },
              },
              granted: {
                servers: {
                  slack: {
                    tools: ["list_channels"],
                    readPaths: [],
                    writePaths: [],
                  },
                },
              },
            },
          ]),
        setGrant: setGrant || jest.fn().mockResolvedValue(true),
      },
    };
  }

  const installedWithGrants = [
    {
      name: "SlackListChannels",
      packageId: "@trops/slack",
      source: "installed",
      version: "0.0.700",
    },
  ];

  test("suspends the batch via pendingPreflight when new perms are declared", async () => {
    installMainApiForPreflight();
    const { result } = renderHook(() =>
      useWidgetUpdates(installedWithGrants, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(1);
    });

    let batchPromise;
    act(() => {
      batchPromise = result.current.updatePackages(["@trops/slack"]);
    });

    await waitFor(() => {
      expect(result.current.pendingPreflight).not.toBeNull();
    });
    expect(result.current.pendingPreflight.widgets).toHaveLength(1);
    expect(
      result.current.pendingPreflight.widgets[0].missing.servers.slack,
    ).toEqual({
      tools: ["send_message"],
      readPaths: [],
      writePaths: [],
    });
    // Install has NOT fired yet — the batch is suspended on the
    // preflight resolver.
    expect(window.mainApi.widgets.install).not.toHaveBeenCalled();

    // Cancel — the batch returns with cancelled:true, no installs,
    // no grant writes.
    act(() => {
      result.current.resolvePreflight(null);
    });
    const summary = await batchPromise;
    expect(summary).toEqual({
      succeeded: [],
      failed: [],
      cancelled: true,
    });
    expect(window.mainApi.widgets.install).not.toHaveBeenCalled();
    expect(window.mainApi.widgetMcp.setGrant).not.toHaveBeenCalled();
  });

  test("approval writes accepted grants BEFORE installs run, then runs the batch", async () => {
    installMainApiForPreflight();
    const { result } = renderHook(() =>
      useWidgetUpdates(installedWithGrants, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(1);
    });

    let batchPromise;
    act(() => {
      batchPromise = result.current.updatePackages(["@trops/slack"]);
    });
    await waitFor(() => {
      expect(result.current.pendingPreflight).not.toBeNull();
    });

    // Approve with the single new tool checked.
    const widgetId = result.current.pendingPreflight.widgets[0].widgetId;
    act(() => {
      result.current.resolvePreflight({
        acceptedByWidgetId: {
          [widgetId]: {
            servers: {
              slack: {
                tools: ["send_message"],
                readPaths: [],
                writePaths: [],
              },
            },
          },
        },
      });
    });
    const summary = await batchPromise;

    // Grant was written WITH the existing tool unioned in.
    expect(window.mainApi.widgetMcp.setGrant).toHaveBeenCalledWith(
      widgetId,
      expect.objectContaining({
        servers: expect.objectContaining({
          slack: expect.objectContaining({
            tools: expect.arrayContaining(["list_channels", "send_message"]),
          }),
        }),
      }),
    );
    // Then install fired.
    expect(window.mainApi.widgets.install).toHaveBeenCalledTimes(1);
    expect(summary.succeeded).toEqual(["@trops/slack"]);
    expect(summary.failed).toEqual([]);
  });

  test("install reports success but on-disk version did NOT change → batch row is marked failed (no more '✓ done' lie)", async () => {
    // The original-original bug: registry serves a stale zip OR
    // package wasn't actually republished. Install IPC returns ok,
    // setRegistry is happy, the row was being marked "done", user
    // reloaded and saw the same updates pending. With the
    // post-install verify step, the row throws and the modal
    // surfaces the mismatch.
    const install = jest.fn().mockResolvedValue({ ok: true });
    const get = jest.fn().mockResolvedValue({
      // Disk still has the OLD version after the install supposedly
      // succeeded.
      name: "@trops/slack",
      packageId: "@trops/slack",
      version: "0.0.700",
    });
    window.mainApi = {
      registry: {
        checkUpdates: jest.fn().mockResolvedValue([
          {
            name: "@trops/slack",
            currentVersion: "0.0.700",
            latestVersion: "0.0.735",
            downloadUrl: "https://reg.example/{name}-{version}.zip",
          },
        ]),
        fetchPackageManifest: jest.fn().mockResolvedValue({
          packageId: "@trops/slack",
          version: "0.0.735",
          permissions: null,
        }),
      },
      registryAuth: {
        getProfile: jest.fn().mockResolvedValue({ id: "user-1" }),
      },
      widgets: {
        install,
        get,
      },
      widgetMcp: {
        listAll: jest.fn().mockResolvedValue([]),
        setGrant: jest.fn(),
      },
    };
    const { result } = renderHook(() =>
      useWidgetUpdates(
        [
          {
            name: "SlackListChannels",
            packageId: "@trops/slack",
            source: "installed",
            version: "0.0.700",
          },
        ],
        jest.fn(),
      ),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(1);
    });

    let summary;
    await act(async () => {
      summary = await result.current.updatePackages(["@trops/slack"]);
    });

    expect(install).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("@trops/slack");
    // The batch summary marks this as FAILED with the verify error,
    // NOT silently "done".
    expect(summary.succeeded).toEqual([]);
    expect(summary.failed).toEqual(["@trops/slack"]);
    expect(result.current.batchStatus.get("@trops/slack")).toMatchObject({
      status: "failed",
      error: expect.stringMatching(
        /on-disk version is 0\.0\.700 \(expected 0\.0\.735\)/,
      ),
    });
  });

  test("install verify passes when on-disk version matches latestVersion → row done", async () => {
    const install = jest.fn().mockResolvedValue({ ok: true });
    const get = jest.fn().mockResolvedValue({
      name: "@trops/slack",
      packageId: "@trops/slack",
      version: "0.0.735",
    });
    window.mainApi = {
      registry: {
        checkUpdates: jest.fn().mockResolvedValue([
          {
            name: "@trops/slack",
            currentVersion: "0.0.700",
            latestVersion: "0.0.735",
            downloadUrl: "https://reg.example/{name}-{version}.zip",
          },
        ]),
        fetchPackageManifest: jest.fn().mockResolvedValue({
          packageId: "@trops/slack",
          version: "0.0.735",
          permissions: null,
        }),
      },
      registryAuth: {
        getProfile: jest.fn().mockResolvedValue({ id: "user-1" }),
      },
      widgets: { install, get },
      widgetMcp: {
        listAll: jest.fn().mockResolvedValue([]),
        setGrant: jest.fn(),
      },
    };
    const { result } = renderHook(() =>
      useWidgetUpdates(
        [
          {
            name: "SlackListChannels",
            packageId: "@trops/slack",
            source: "installed",
            version: "0.0.700",
          },
        ],
        jest.fn(),
      ),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(1);
    });

    let summary;
    await act(async () => {
      summary = await result.current.updatePackages(["@trops/slack"]);
    });
    expect(summary.succeeded).toEqual(["@trops/slack"]);
    expect(summary.failed).toEqual([]);
  });

  test("no preflight when nothing is missing — install runs silently", async () => {
    // listAll returns a grant covering EVERYTHING the new manifest
    // declares, so the diff comes back empty and the batch proceeds
    // straight to install.
    installMainApiForPreflight({
      listAll: jest.fn().mockResolvedValue([
        {
          widgetId: "trops.slack.SlackListChannels",
          declared: {
            servers: {
              slack: {
                tools: ["list_channels", "send_message"],
                readPaths: [],
                writePaths: [],
              },
            },
          },
          granted: {
            servers: {
              slack: {
                tools: ["list_channels", "send_message"],
                readPaths: [],
                writePaths: [],
              },
            },
          },
        },
      ]),
    });
    const { result } = renderHook(() =>
      useWidgetUpdates(installedWithGrants, jest.fn()),
    );
    await waitFor(() => {
      expect(result.current.packagesWithUpdates.length).toBe(1);
    });

    let summary;
    await act(async () => {
      summary = await result.current.updatePackages(["@trops/slack"]);
    });

    expect(result.current.pendingPreflight).toBeNull();
    expect(window.mainApi.widgets.install).toHaveBeenCalledTimes(1);
    expect(window.mainApi.widgetMcp.setGrant).not.toHaveBeenCalled();
    expect(summary.succeeded).toEqual(["@trops/slack"]);
  });
});

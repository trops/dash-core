import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// --- Preflight helpers ---
//
// Pure utilities for computing the "what's newly required" diff used
// to gate a batch update on user consent BEFORE any install actually
// runs. Same shape conventions as
// src/utils/computeDashboardPreflight.js (which solves the
// related "dashboard load" problem); keeping these inline here so
// the update hook is self-contained, doesn't take a dependency on
// PreflightConsentModal's internals, and stays testable.

function _diffArray(declared, granted) {
  const grantedSet = new Set(granted || []);
  return (declared || []).filter((x) => !grantedSet.has(x));
}

/**
 * Diff a package-level declared MCP block against a single widget's
 * granted MCP block. Returns a `{servers: {...}}` shape of just the
 * NEW perms (declared but not yet granted).
 */
export function diffMcpServers(declaredServers, grantedServers) {
  const out = {};
  if (!declaredServers || typeof declaredServers !== "object") return out;
  for (const [name, decl] of Object.entries(declaredServers)) {
    const grant = grantedServers && grantedServers[name];
    const tools = _diffArray(decl.tools, grant?.tools);
    const readPaths = _diffArray(decl.readPaths, grant?.readPaths);
    const writePaths = _diffArray(decl.writePaths, grant?.writePaths);
    if (
      tools.length === 0 &&
      readPaths.length === 0 &&
      writePaths.length === 0
    ) {
      continue;
    }
    out[name] = { tools, readPaths, writePaths };
  }
  return out;
}

/**
 * Merge an addition (user-accepted lines from the preflight modal)
 * into the existing grant blob. Additive only — never drops
 * previously-granted items, never replaces with an empty subset.
 * Mirrors the merge in PreflightConsentModal but server-only (fs /
 * network domains land here when their preflight surfaces in a
 * later iteration).
 */
export function mergeMcpGrants(existing, addition) {
  const out = {
    grantOrigin: addition?.grantOrigin || existing?.grantOrigin || "declared",
    servers: { ...(existing?.servers || {}) },
  };
  for (const [name, perms] of Object.entries(addition?.servers || {})) {
    const prev = out.servers[name] || {
      tools: [],
      readPaths: [],
      writePaths: [],
    };
    out.servers[name] = {
      tools: [...new Set([...(prev.tools || []), ...(perms.tools || [])])],
      readPaths: [
        ...new Set([...(prev.readPaths || []), ...(perms.readPaths || [])]),
      ],
      writePaths: [
        ...new Set([...(prev.writePaths || []), ...(perms.writePaths || [])]),
      ],
    };
  }
  return out;
}

/**
 * useWidgetUpdates — checks the registry for newer versions of installed widgets
 * and provides a one-click update function.
 *
 * @param {Array} installedWidgets - Widgets from useInstalledWidgets()
 * @param {Function} onUpdated - Callback after a successful update (e.g. refresh)
 * @returns {{
 *   updates: Map,
 *   packagesWithUpdates: Array<{name, installedVersion, latestVersion, downloadUrl, widgetNames}>,
 *   isChecking: boolean,
 *   updateWidget: Function,
 *   updatePackages: Function,
 *   isUpdating: string|null,
 *   batchStatus: Map<string, {status: "pending"|"in-progress"|"done"|"failed", error?: string}>,
 *   isBatchUpdating: boolean,
 *   needsAuth: boolean,
 *   clearNeedsAuth: Function,
 *   updateError: string|null
 * }}
 */
export function useWidgetUpdates(installedWidgets = [], onUpdated) {
  const [updates, setUpdates] = useState(new Map());
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  // batchStatus tracks the per-package progress during an updatePackages
  // run so the "Update all" modal can show pending/in-progress/done/failed
  // pips next to each row. Cleared (Map -> empty) when isBatchUpdating
  // flips back to false; consumers that want to keep showing a per-package
  // result after the batch finished should snapshot it themselves.
  const [batchStatus, setBatchStatus] = useState(new Map());
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const checkedRef = useRef(false);
  // Pre-install preflight state. When the batch update needs the user
  // to approve new MCP grants BEFORE we download anything, the hook
  // populates pendingPreflight and suspends on preflightResolverRef.
  // The UI reads pendingPreflight to render the consent panel and
  // calls resolvePreflight(decision) to unblock the batch:
  //   - decision === null         → user cancelled; entire batch aborted
  //   - decision === { ... }      → user approved; grants written, installs run
  const [pendingPreflight, setPendingPreflight] = useState(null);
  const preflightResolverRef = useRef(null);

  // Diagnostic breadcrumbs pushed onto window.__DASH_DEBUG. We can't
  // use console.* here — dash-core's rollup build runs
  // @rollup/plugin-strip which removes every console call from dist,
  // so any console output we add is silent in the linked production
  // build the user actually runs. Dump in DevTools with
  // `copy(window.__DASH_DEBUG)` after a failed batch.
  const pushDiag = (event, data) => {
    (window.__DASH_DEBUG ||= []).push({
      t: Date.now(),
      src: "useWidgetUpdates",
      event,
      ...data,
    });
  };

  // Core check-for-updates pass. Extracted so the post-batch
  // re-check (after updatePackages finishes) can reuse the same
  // logic without duplicating the payload + Map-keying code.
  //
  // ALWAYS calls setUpdates (with an empty Map when nothing's
  // available) — previously, an empty result didn't fire setUpdates,
  // leaving stale entries from a prior check visible after the
  // batch cleared them locally. This was the bug behind "Updates
  // Available button stays visible after running the batch".
  const runUpdateCheck = useCallback((installedList) => {
    const installed = (installedList || []).filter(
      (w) => w.source === "installed" && w.version,
    );
    if (installed.length === 0) {
      setUpdates(new Map());
      return Promise.resolve();
    }
    setIsChecking(true);
    pushDiag("runUpdateCheck:start", { installedCount: installed.length });

    // Deduplicate by package — multiple widgets in the same package
    // share one version.
    const pkgMap = new Map();
    installed.forEach((w) => {
      const pkgId = w.packageId || w.name;
      if (!pkgMap.has(pkgId)) {
        pkgMap.set(pkgId, { name: pkgId, version: w.version });
      }
    });
    const payload = Array.from(pkgMap.values());

    return (
      window.mainApi?.registry
        ?.checkUpdates(payload)
        .then((results) => {
          if (Array.isArray(results) && results.length > 0) {
            const map = new Map();
            results.forEach((r) => {
              // Key by package ID (from result).
              map.set(r.name, r);
              // Also key by each widget's CM key so UI can look up
              // by widget name.
              installed.forEach((w) => {
                const pkgId = w.packageId || w.name;
                if (pkgId === r.name) {
                  map.set(w.name, r);
                }
              });
            });
            setUpdates(map);
            pushDiag("runUpdateCheck:results", {
              count: results.length,
              packages: results.map((r) => r.name),
            });
          } else {
            // No updates available — explicitly clear the Map so the
            // UI reflects the actual registry state. Without this,
            // a successful batch update would leave the "Updates
            // Available" CTA visible.
            setUpdates(new Map());
            pushDiag("runUpdateCheck:results", { count: 0 });
          }
        })
        .catch((err) => {
          pushDiag("runUpdateCheck:error", { message: err.message });
        })
        .finally(() => {
          setIsChecking(false);
        }) || Promise.resolve()
    );
  }, []);

  // Initial check, runs once per mount when installedWidgets first
  // arrives. Gated by checkedRef so re-renders don't refire it —
  // post-batch re-checks happen explicitly via runUpdateCheck from
  // updatePackages.
  useEffect(() => {
    if (checkedRef.current) return;
    const hasInstalled = installedWidgets.some(
      (w) => w.source === "installed" && w.version,
    );
    if (!hasInstalled) return;
    checkedRef.current = true;
    runUpdateCheck(installedWidgets);
  }, [installedWidgets, runUpdateCheck]);

  // Update a single widget by downloading the latest version.
  //
  // `options.throwOnError` (default false) re-throws after setting
  // updateError state. Off by default so the single-update callers
  // (detail-view Update button) keep their fire-and-forget shape;
  // the batch updatePackages path passes `true` so it can per-row
  // report success/fail in batchStatus.
  const updateWidget = useCallback(
    async (name, options = {}) => {
      const throwOnError = options && options.throwOnError === true;
      pushDiag("updateWidget:start", { name });
      const info = updates.get(name);
      if (!info) {
        pushDiag("updateWidget:bail-no-info", {
          name,
          availableKeys: Array.from(updates.keys()),
        });
        setUpdateError(`No update info found for "${name}".`);
        return;
      }
      if (!info.downloadUrl) {
        pushDiag("updateWidget:bail-no-download-url", { name, info });
        setUpdateError(
          `Update for "${name}" has no download URL. The registry entry may be incomplete.`,
        );
        return;
      }

      // Use packageId for install — name may be a CM key (widget-level)
      const widget = installedWidgets.find((w) => w.name === name);
      const packageId = widget?.packageId || info.name || name;
      pushDiag("updateWidget:resolved", {
        name,
        packageId,
        currentVersion: info.currentVersion,
        latestVersion: info.latestVersion,
        downloadUrl: info.downloadUrl,
      });

      setIsUpdating(name);
      setUpdateError(null);
      try {
        // Validate token against registry (not just check if it exists locally)
        pushDiag("updateWidget:getProfile-call", { name });
        const profile = await window.mainApi?.registryAuth?.getProfile();
        pushDiag("updateWidget:getProfile-result", {
          name,
          profileId: profile ? profile.id : null,
        });
        if (!profile) {
          pushDiag("updateWidget:stale-auth", { name });
          setNeedsAuth(true);
          // Batch callers (updatePackages with throwOnError=true) need
          // this to surface as a failure so they don't mark the row
          // "done" — otherwise a stale-auth user clicks Update all,
          // sees every package report "✓ done", reloads, and finds
          // nothing actually installed because each call returned
          // silently here. Single-update detail-view callers keep the
          // fire-and-forget shape (needsAuth still flips, triggering
          // the existing RegistryAuthModal).
          if (throwOnError) {
            throw new Error(
              "Authentication required — sign in to the registry to install updates.",
            );
          }
          return;
        }

        const resolvedUrl = info.downloadUrl
          .replace(/\{version\}/g, info.latestVersion)
          .replace(/\{name\}/g, packageId);

        pushDiag("updateWidget:install-call", { packageId, resolvedUrl });

        const installResult = await window.mainApi.widgets.install(
          packageId,
          resolvedUrl,
        );

        pushDiag("updateWidget:install-result", { packageId, installResult });

        // Post-install version verification.
        //
        // The install IPC has historically returned `ok: true` even when
        // the on-disk version didn't actually advance — registry served
        // a stale zip, registry's downloadUrl pointed at the wrong
        // version, the extraction wrote into a different path than the
        // registry reads back from, etc. Without a check here, the row
        // is marked "✓ done", the user reloads, and the same widgets
        // show up as needing updates AGAIN with the same old version
        // numbers in Settings.
        //
        // Fix: after install resolves, ask the registry IPC what
        // version is now on disk for this packageId. If it doesn't
        // match `info.latestVersion`, throw so the batch row surfaces
        // the failure with the actual numbers — no more silent "done"
        // lies.
        try {
          const onDisk =
            (await window.mainApi.widgets.get?.(packageId)) || null;
          const installedVersion = onDisk?.version || null;
          pushDiag("updateWidget:verify", {
            packageId,
            installedVersion,
            expected: info.latestVersion,
          });
          if (
            installedVersion &&
            info.latestVersion &&
            installedVersion !== info.latestVersion
          ) {
            const msg = `Install reported success but on-disk version is ${installedVersion} (expected ${info.latestVersion}). The registry may be serving a stale zip — verify the package was actually republished.`;
            pushDiag("updateWidget:verify-mismatch", {
              packageId,
              installedVersion,
              expected: info.latestVersion,
            });
            throw new Error(msg);
          }
        } catch (verifyErr) {
          // Re-throw only when verification was the failure. If
          // mainApi.widgets.get is unavailable (older preload) we
          // can't verify — log and fall through; status quo
          // behavior. Wrapping in a try/catch separately from the
          // outer one so a network blip on widgets.get doesn't get
          // confused with an actual install failure.
          if (
            verifyErr?.message?.startsWith(
              "Install reported success but on-disk version is",
            )
          ) {
            throw verifyErr;
          }
          pushDiag("updateWidget:verify-skipped", {
            packageId,
            reason: verifyErr?.message || String(verifyErr),
          });
        }

        // Remove ALL widgets in this package from updates map
        // (install replaces the entire package, not just one widget)
        setUpdates((prev) => {
          const next = new Map(prev);
          for (const [key, val] of next) {
            if (val.name === info.name) next.delete(key);
          }
          return next;
        });

        if (onUpdated) onUpdated();
      } catch (err) {
        pushDiag("updateWidget:fail", {
          name,
          message: err?.message || String(err),
        });
        setUpdateError(err.message || "Update failed");
        if (throwOnError) {
          // Re-throw so the batch caller can mark this row failed.
          // Single-update callers leave throwOnError as false and
          // keep the existing fire-and-forget behavior.
          throw err;
        }
      } finally {
        setIsUpdating(null);
      }
    },
    [updates, onUpdated, installedWidgets],
  );

  const clearNeedsAuth = useCallback(() => setNeedsAuth(false), []);

  // Derived list of packages with updates available, deduped by
  // package id. `updates` carries each entry under TWO keys (the
  // package id AND each widget's CM key — see the .set() loop above);
  // the modal needs the one-row-per-package shape and the list of
  // widget names that ride along so users see what a single package
  // update will actually bring with it.
  const packagesWithUpdates = useMemo(() => {
    if (!updates || updates.size === 0) return [];
    const byPackage = new Map();
    for (const [, info] of updates) {
      if (!info || !info.name) continue;
      if (!byPackage.has(info.name)) {
        byPackage.set(info.name, {
          name: info.name,
          // registryController returns { currentVersion, latestVersion, ... } —
          // see electron/controller/registryController.js checkUpdates().
          currentVersion: info.currentVersion || "",
          latestVersion: info.latestVersion || "",
          downloadUrl: info.downloadUrl || null,
          widgetNames: [],
        });
      }
    }
    // Walk installed widgets so each package row carries the list of
    // widget display names the user will see updated. Useful in the
    // modal for "Slack — updates SlackListChannels, SlackChannelMessages,
    // SlackWidget" disclosure.
    for (const w of installedWidgets) {
      if (!w || w.source !== "installed") continue;
      const pkgId = w.packageId || w.name;
      const entry = byPackage.get(pkgId);
      if (entry && !entry.widgetNames.includes(w.name)) {
        entry.widgetNames.push(w.name);
      }
    }
    return Array.from(byPackage.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [updates, installedWidgets]);

  // Sequentially update each package in `packageNames`. Sequential
  // (not parallel) on purpose: the install IPC hits a single registry
  // endpoint per package and parallel runs would trip auth + create
  // confusing partial-failure states. Per-package status flows into
  // batchStatus so the UI can render pending/in-progress/done/failed
  // pips in real time.
  //
  // Resolves to a summary `{succeeded: string[], failed: string[]}`.
  // Resolve the suspended preflight from the UI side. The modal's
  // Approve button calls resolvePreflight({acceptedByWidgetId}); the
  // Cancel button calls resolvePreflight(null).
  const resolvePreflight = useCallback((decision) => {
    pushDiag("preflight:resolved", {
      cancelled: decision === null,
      approvedWidgets:
        decision && decision.acceptedByWidgetId
          ? Object.keys(decision.acceptedByWidgetId).length
          : 0,
    });
    const resolver = preflightResolverRef.current;
    preflightResolverRef.current = null;
    setPendingPreflight(null);
    if (resolver) resolver(decision);
  }, []);

  // Scan the pending batch's new manifests against the user's
  // existing grants; return the per-widget delta (or null if no new
  // grants are needed and the batch can run silently).
  const computeBatchPreflight = useCallback(
    async (packageNames) => {
      if (!window.mainApi?.registry?.fetchPackageManifest) {
        // Older dash-electron preload — no manifest IPC. Fall
        // through; the post-install consent path still fires.
        pushDiag("preflight:no-manifest-ipc");
        return null;
      }

      // Fetch new manifests in parallel. Soft-fail per package — a
      // network hiccup on one shouldn't abort the whole preflight;
      // the post-install consent path picks up anything we missed.
      const manifests = await Promise.all(
        packageNames.map(async (n) => {
          try {
            const m = await window.mainApi.registry.fetchPackageManifest(n);
            return { name: n, manifest: m };
          } catch (e) {
            pushDiag("preflight:manifest-fetch-failed", {
              name: n,
              error: e?.message,
            });
            return { name: n, manifest: null };
          }
        }),
      );

      // Existing grants (one row per installed widgetId).
      let allRows = [];
      try {
        allRows = (await window.mainApi.widgetMcp?.listAll?.()) || [];
      } catch (e) {
        pushDiag("preflight:listAll-failed", { error: e?.message });
      }

      const rowByWidgetId = new Map(allRows.map((r) => [r.widgetId, r]));
      // For mapping installedWidgets (which carry componentName +
      // packageId) → grant rows (which are keyed by widgetId like
      // `trops.slack.SlackChannels`).
      const rowByComponentName = new Map();
      for (const r of allRows) {
        const bare = r.widgetId.split(".").pop();
        if (bare) rowByComponentName.set(bare, r);
      }

      const widgetsWithMissing = [];
      for (const { name: packageId, manifest } of manifests) {
        const declaredMcp = manifest?.permissions?.mcp;
        if (!declaredMcp || Object.keys(declaredMcp).length === 0) continue;

        // Find installed widgets that belong to this package. The
        // new version may add widgets not yet installed — those fall
        // through to the post-install consent path since we don't
        // have a widgetId to attach a grant to until they're on disk.
        const pkgWidgets = installedWidgets.filter(
          (w) => (w.packageId || w.name) === packageId,
        );
        for (const w of pkgWidgets) {
          const matchingRow =
            rowByComponentName.get(w.name) ||
            rowByWidgetId.get(`${packageId}.${w.name}`);
          const widgetId = matchingRow?.widgetId || `${packageId}.${w.name}`;
          const grantedMcp = matchingRow?.granted?.servers || {};
          const missingServers = diffMcpServers(declaredMcp, grantedMcp);
          if (Object.keys(missingServers).length === 0) continue;
          widgetsWithMissing.push({
            widgetId,
            displayName: w.name,
            packageId,
            packageNewVersion: manifest?.version || null,
            missing: { servers: missingServers },
            granted: matchingRow?.granted || null,
          });
        }
      }

      pushDiag("preflight:computed", {
        packageCount: packageNames.length,
        widgetsNeedingApproval: widgetsWithMissing.length,
      });
      return widgetsWithMissing.length === 0
        ? null
        : { widgets: widgetsWithMissing };
    },
    [installedWidgets],
  );

  const updatePackages = useCallback(
    async (packageNames) => {
      if (!Array.isArray(packageNames) || packageNames.length === 0) {
        return { succeeded: [], failed: [] };
      }
      // Seed every selected package as pending so the modal renders
      // the full per-row state from the first paint.
      const initial = new Map();
      for (const name of packageNames) {
        initial.set(name, { status: "pending" });
      }
      setBatchStatus(initial);
      setIsBatchUpdating(true);
      setUpdateError(null);

      // --- Pre-install preflight ---
      // Ask the registry what each new version requires, diff
      // against the user's current grants, and bail out to the UI
      // for approval before downloading anything. If approved, the
      // accepted grants are persisted FIRST; then the install loop
      // runs knowing every widget will have the perms it needs the
      // moment it lands on disk.
      try {
        const preflight = await computeBatchPreflight(packageNames);
        if (preflight) {
          setPendingPreflight(preflight);
          const decision = await new Promise((resolve) => {
            preflightResolverRef.current = resolve;
          });
          if (!decision) {
            // User cancelled the entire batch from the preflight.
            // No installs run, no grants written — leave state as
            // if they never clicked Update.
            setBatchStatus(new Map());
            setIsBatchUpdating(false);
            return {
              succeeded: [],
              failed: [],
              failedDetails: [],
              cancelled: true,
            };
          }
          // Persist accepted grants per widget BEFORE the install
          // loop so the freshly-installed code can immediately use
          // what was approved (and is gated from what wasn't).
          const accepted = decision.acceptedByWidgetId || {};
          for (const w of preflight.widgets) {
            const acceptedAddition = accepted[w.widgetId];
            if (!acceptedAddition) continue;
            const merged = mergeMcpGrants(w.granted, acceptedAddition);
            try {
              // Race against a 10s timeout so a hung IPC handler
              // (e.g. main-process error swallowed in setGrant,
              // disk lock, etc.) can't block the install loop
              // forever. A timeout still falls through to install —
              // the post-install consent path will re-prompt if the
              // gate ends up denying.
              await Promise.race([
                window.mainApi?.widgetMcp?.setGrant?.(w.widgetId, merged),
                new Promise((_, reject) =>
                  setTimeout(
                    () =>
                      reject(
                        new Error(
                          "setGrant timeout (10s) — proceeding without preflight grant",
                        ),
                      ),
                    10000,
                  ),
                ),
              ]);
              pushDiag("preflight:grant-written", {
                widgetId: w.widgetId,
                serverCount: Object.keys(merged.servers || {}).length,
              });
            } catch (e) {
              pushDiag("preflight:grant-write-failed", {
                widgetId: w.widgetId,
                error: e?.message,
              });
              // Don't bail the batch on a single grant-write error;
              // the install still proceeds and the post-install
              // consent flow will re-prompt if the gate denies.
            }
          }
        }
      } catch (e) {
        // Preflight pipeline itself failed (not the user cancelling).
        // Don't block installs — fall through to the legacy flow.
        pushDiag("preflight:pipeline-error", { error: e?.message });
      }

      // Breadcrumb at install-loop entry so we know preflight handed
      // off control — if the user reports "nothing happened after I
      // clicked Accept", the absence of this breadcrumb means we
      // never reached the install loop (preflight grant write
      // hung, exception in cleanup, etc.) and its presence narrows
      // the bug to the install IPC.
      pushDiag("updatePackages:install-loop-start", {
        packageCount: packageNames.length,
        packageNames,
      });
      const succeeded = [];
      const failed = [];
      // Per-package error detail so the modal banner can render
      // WHY each row failed (was previously just "X failed" with no
      // text — completely unhelpful when the actual problem was
      // e.g. a stale registry zip or a verify mismatch).
      const failedDetails = [];
      try {
        for (const pkgName of packageNames) {
          // Mark in-progress BEFORE the await so the spinner appears
          // immediately, not after the install finishes.
          setBatchStatus((prev) => {
            const next = new Map(prev);
            next.set(pkgName, { status: "in-progress" });
            return next;
          });
          try {
            // Reuse the existing single-update path so any future
            // behavior (auth flow, error normalization, refresh
            // callback) stays in one place. updateWidget keys on
            // either a package id or a widget CM key — the
            // packagesWithUpdates entries use `name = info.name`,
            // which IS the package id, so this works.
            await updateWidget(pkgName, { throwOnError: true });
            setBatchStatus((prev) => {
              const next = new Map(prev);
              next.set(pkgName, { status: "done" });
              return next;
            });
            succeeded.push(pkgName);
          } catch (err) {
            const msg = (err && err.message) || "Update failed";
            setBatchStatus((prev) => {
              const next = new Map(prev);
              next.set(pkgName, { status: "failed", error: msg });
              return next;
            });
            failed.push(pkgName);
            failedDetails.push({ name: pkgName, error: msg });
            // Continue to the next package — one failure shouldn't
            // abort the whole run. The modal surfaces each per-row
            // failure individually so the user can retry just those.
          }
        }
      } finally {
        setIsBatchUpdating(false);
      }
      pushDiag("updatePackages:install-loop-end", {
        succeededCount: succeeded.length,
        failedCount: failed.length,
      });
      // Post-batch authoritative clear: remove every succeeded
      // package's entries from the Map by package id. The per-
      // package setUpdates inside updateWidget already does this,
      // but the user has reported the Map staying populated after a
      // batch — likely because functional-setState merges across
      // 20+ sequential calls can interact unexpectedly with the
      // surrounding closure / iteration order. This belt-and-
      // suspenders pass operates on the final committed state, uses
      // a single setState, and is keyed by the package ids we just
      // KNOW we updated — no closure-staleness, no reliance on
      // val.name matching info.name across many fired updates.
      //
      // Failed packages stay in the Map so the per-widget "Update"
      // badges + the trigger button remain visible for retry.
      if (succeeded.length > 0) {
        const succeededSet = new Set(succeeded);
        setUpdates((prev) => {
          const next = new Map(prev);
          for (const [key, val] of next) {
            if (val && succeededSet.has(val.name)) {
              next.delete(key);
            }
          }
          return next;
        });
      }
      return { succeeded, failed, failedDetails };
    },
    [updateWidget, computeBatchPreflight],
  );

  return {
    updates,
    packagesWithUpdates,
    isChecking,
    updateWidget,
    updatePackages,
    isUpdating,
    batchStatus,
    isBatchUpdating,
    needsAuth,
    clearNeedsAuth,
    updateError,
    pendingPreflight,
    resolvePreflight,
  };
}

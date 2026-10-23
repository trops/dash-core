import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Button,
  Button3,
  ConfirmationModal,
  FilterMenu,
  FontAwesomeIcon,
  ListRow,
  Modal,
  PanelHeader,
  SearchInput,
  SectionLabel,
  SegmentedControl,
  StatusBadge,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { WidgetPreview } from "./WidgetPreview";
import { useRegistryIdentity } from "./useRegistryIdentity";
import { useInstalledWidgets } from "../../hooks/useInstalledWidgets";
import { useWidgetUpdates } from "../../hooks/useWidgetUpdates";
import {
  isRegistryAuthError,
  useRegistryAuthGate,
} from "../../hooks/useRegistryAuthGate";
import { resolveIcon } from "../../utils/resolveIcon";
import { getUserConfigurableProviders } from "../../utils/providerUtils";
import { WidgetPreflightReview } from "../WidgetPreflightReview";
import { InstallWidgetPicker } from "../Settings/details/InstallWidgetPicker";
import { DiscoverWidgetsDetail } from "../Settings/details/DiscoverWidgetsDetail";
import { InstallProgressModal } from "../Settings/details/InstallProgressModal";
import { PublishWidgetModal } from "../Settings/details/PublishWidgetModal";
import { UpdateAllWidgetsModal } from "../Settings/sections/UpdateAllWidgetsModal";
import { useWidgetInstall } from "./useWidgetInstall";
import {
  filterOrgs,
  packageLabel,
  packageWidgets,
  searchResults,
  uninstallCopy,
  widgetOrgs,
  widgetTitle,
  widgetTotals,
} from "./widgetSummary";
import { ListGroupLabel, ManageLayout, OverflowMenu } from "./ManageLayout";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Registered widget config (userConfig defaults for the live preview).
const getWidgetConfig = (name) =>
  (name && ComponentManager.config && ComponentManager.config(name)) || null;
const CHIPS = [
  { value: "all", label: "All" },
  { value: "inUse", label: "In use" },
  { value: "notUsed", label: "Not used" },
  { value: "mine", label: "Mine" },
];
const chipLabel = (chip) => (CHIPS.find((c) => c.value === chip) || {}).label;

const openBuilder = (detail) =>
  window.dispatchEvent(
    detail
      ? new CustomEvent("dash:open-widget-builder", { detail })
      : new Event("dash:open-widget-builder"),
  );

/**
 * An installed widget's one door: Change <widget> (Create › Change, the same
 * event as a dashboard widget's — consolidation Phase 3P). Create offers the
 * Dash team, and "Edit the code yourself" for your own widgets.
 */
const openWidget = (event, widget, pkg) => {
  const component =
    ((widget && widget.componentNames) || []).find(
      (n) => n && !String(n).startsWith("@"),
    ) ||
    (widget && widget.name);
  window.dispatchEvent(
    new CustomEvent(event, {
      detail: {
        widgetComponentName: component,
        sourcePackage: pkg.id,
        // "<package>/<component>": not on a dashboard, so nothing is
        // swapped or placed when it's done.
        widgetId: `${pkg.id}/${component}`,
      },
    }),
  );
};
const changeWidget = (widget, pkg) =>
  openWidget("dash:edit-widget-with-ai", widget, pkg);
const widgetLabel = (widget) =>
  (widget && (widget.displayName || widget.name)) || "this widget";

/** Dashboards using a package or widget, each with Open. */
const UsedOn = ({ usage, workspaces, onOpenWorkspace, muted }) => {
  if (!usage.length) {
    return <span className={`text-sm ${muted}`}>Not on any dashboard yet</span>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {usage.map((u) => {
        const ws = workspaces.find((w) => w.id === u.workspaceId);
        return (
          <div
            key={u.workspaceId}
            className="flex flex-row items-center justify-between gap-3 text-sm"
          >
            <span className="truncate">
              {u.workspaceName}
              {u.count > 1 ? (
                <span className={`text-xs ${muted}`}> · {u.count} times</span>
              ) : null}
            </span>
            {ws && onOpenWorkspace ? (
              <Button3
                title="Open"
                size="sm"
                onClick={() => onOpenWorkspace(ws)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/** True when an installed package didn't pass its checks (Phase 1a-2). */
const failedChecks = (pkg) =>
  !pkg.isBuiltIn && !pkg.isDraft && !!pkg.checks && pkg.checks.ok === false;

/**
 * What was checked (consolidation Phase 1a-2): a package that didn't pass
 * is flagged with every reason — it still works — and a package that
 * ships its own build says Dash checked its source, not that build.
 */
const PackageChecks = ({ pkg, installed }) => {
  const { muted } = useConfigTokens();
  const problems = (pkg.checks && pkg.checks.problems) || [];
  return (
    <>
      {failedChecks(pkg) ? (
        <div data-testid="package-checks" className="flex flex-col gap-1">
          <span>
            <StatusBadge state="warning" label="Didn't pass its checks" />
          </span>
          <span className={`text-xs ${muted}`}>
            It still works, but these need fixing:
          </span>
          <ul className="flex flex-col gap-0.5">
            {problems.map((p, i) => (
              <li key={i} className="text-xs whitespace-pre-wrap">
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {installed && pkg.build === "developer" ? (
        <span className={`text-xs ${muted}`}>
          {pkg.checks && pkg.checks.sourceChecked === false
            ? "Runs the code its developer packaged — it came without its source, so Dash couldn't check it."
            : pkg.checks && pkg.checks.rebuildError
              ? "Runs the code its developer packaged — Dash checked its source but couldn't build it here. Its developer can republish it so Dash can build it."
              : "Runs the code its developer packaged — Dash checked the source that came with it."}
        </span>
      ) : null}
      {installed &&
      pkg.build === "developer" &&
      pkg.checks &&
      pkg.checks.rebuildError ? (
        <span className={`text-xs whitespace-pre-wrap ${muted}`}>
          Why: {pkg.checks.rebuildError}
        </span>
      ) : null}
    </>
  );
};

/**
 * A package's details (the right-hand panel). Its widgets are the list on
 * the left once it's open (Phase 4b), so they aren't repeated here.
 */
const PackageDetail = ({
  pkg,
  workspaces,
  updateError,
  isUpdating,
  onOpenWorkspace,
  onOpenPrivacySettings,
  onUpdate,
  onPublish,
  onRemove,
  identity,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const first = pkg.widgets[0] || {};
  const installed = !pkg.isBuiltIn && !pkg.isDraft;
  // The user's own package (their scope, or local AI-built): they can
  // publish it — always under their own username — and edit it.
  const own = pkg.mine && !pkg.isBuiltIn;
  // A draft saved before its first build has nothing to publish yet.
  const unbuilt = pkg.isDraft && first.source === "draft";
  const signedIn = !!(identity && identity.signedIn);
  const published = own && identity ? identity.publishedVersion(pkg.id) : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-row items-center gap-3 min-w-0">
          <span
            className={`flex items-center justify-center h-10 w-10 rounded-lg border flex-shrink-0 ${hairline}`}
          >
            <FontAwesomeIcon icon="box" />
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <h3 className={`text-lg font-semibold truncate ${strong}`}>
              {packageLabel(pkg)}
            </h3>
            {pkg.isBuiltIn ? null : (
              <span className={`text-xs font-mono truncate ${muted}`}>
                {pkg.id}
              </span>
            )}
            <span className={`text-xs ${muted}`}>
              {pkg.source}
              {pkg.version ? ` · v${pkg.version}` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          {installed && pkg.update ? (
            <Button
              title={
                isUpdating
                  ? "Updating…"
                  : `Update to v${pkg.update.latestVersion}`
              }
              size="sm"
              disabled={isUpdating}
              onClick={() => onUpdate(pkg)}
            />
          ) : null}
          {pkg.isDraft ? (
            <Button
              title="Resume"
              size="sm"
              disabled={!first.draftId}
              onClick={() => openBuilder({ resumeDraftId: first.draftId })}
            />
          ) : null}
          {own && signedIn && !unbuilt ? (
            <Button3
              title={published ? "Publish new version…" : "Publish…"}
              size="sm"
              onClick={() => onPublish(pkg)}
            />
          ) : null}
          {/* Changing is per widget: a package with one widget offers it
              here; otherwise each widget's page does. */}
          {own && !pkg.isDraft && (pkg.widgets || []).length === 1 ? (
            <Button3
              title={`Change ${widgetLabel(first)}`}
              size="sm"
              onClick={() => changeWidget(first, pkg)}
            />
          ) : null}
          {/* Less-used and destructive actions: the … menu (Uninstall
              and Delete confirm first). */}
          <OverflowMenu
            items={[
              !pkg.isBuiltIn && first.path
                ? {
                    label: "Open in Finder",
                    icon: "folder-open",
                    onClick: () => window.mainApi?.shell?.openPath(first.path),
                  }
                : null,
              pkg.isBuiltIn
                ? null
                : {
                    label: pkg.isDraft ? "Delete" : "Uninstall",
                    icon: "trash-can",
                    onClick: () => onRemove(pkg),
                  },
            ]}
          />
        </div>
      </div>
      {own && !unbuilt ? (
        <span className={`text-xs ${muted}`}>
          {!signedIn
            ? "Sign in to the registry to publish."
            : published
              ? `Published v${published} · installed v${pkg.version || "?"}`
              : "Not published yet"}
        </span>
      ) : null}
      {updateError && installed && pkg.update ? (
        <span className="text-xs text-red-400">{updateError}</span>
      ) : null}
      <PackageChecks pkg={pkg} installed={installed} />
      {pkg.description ? <p className="text-sm">{pkg.description}</p> : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Used on" />
          <UsedOn
            usage={pkg.usedOn}
            workspaces={workspaces}
            onOpenWorkspace={onOpenWorkspace}
            muted={muted}
          />
        </div>
        <div
          data-testid="needs-providers"
          className="flex flex-col gap-2 min-w-0"
        >
          <SectionLabel text="Needs providers" />
          {pkg.providers.length ? (
            <div className="flex flex-row flex-wrap gap-1.5">
              {pkg.providers.map((p) => (
                <span
                  key={p}
                  className={`px-2 py-0.5 rounded border text-xs ${hairline}`}
                >
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>None</span>
          )}
        </div>
        {pkg.isBuiltIn ? null : (
          <div className="flex flex-col gap-2 min-w-0">
            <SectionLabel text="Permissions" />
            <span className={`text-sm ${muted}`}>
              What these widgets may access is managed in Privacy & Security.
            </span>
            {onOpenPrivacySettings ? (
              <div>
                <Button3
                  title="Manage permissions"
                  size="sm"
                  onClick={onOpenPrivacySettings}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * One widget's details. Its package is the list on the left (Phase 4b), so
 * there's no back link here; Uninstall (package-level) is in its … menu.
 */
const WidgetDetail = ({
  pkg,
  widget,
  workspaces,
  appProviders,
  onOpenWorkspace,
  onRemove,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const providers = getUserConfigurableProviders(widget.providers);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-row items-center gap-3 min-w-0">
          <span
            className={`flex items-center justify-center h-10 w-10 rounded-lg border flex-shrink-0 ${hairline}`}
          >
            <FontAwesomeIcon icon={resolveIcon(widget.icon)} />
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <h3 className={`text-lg font-semibold truncate ${strong}`}>
              {widgetTitle(widget)}
            </h3>
            <span className={`text-xs font-mono truncate ${muted}`}>
              {widget.name}
            </span>
          </div>
        </div>
        {!pkg.isBuiltIn && !pkg.isDraft ? (
          // Anyone's widget can be changed — someone else's is saved as a
          // new widget; Create offers editing the code by hand for yours.
          <div className="flex flex-row flex-wrap items-center gap-2 flex-shrink-0">
            <Button3
              title={`Change ${widgetLabel(widget)}`}
              size="sm"
              onClick={() => changeWidget(widget, pkg)}
            />
            <OverflowMenu
              items={[
                {
                  label: `Uninstall ${packageLabel(pkg)}…`,
                  icon: "trash-can",
                  onClick: () => onRemove(pkg, widget),
                },
              ]}
            />
          </div>
        ) : null}
      </div>
      {widget.description ? (
        <p className="text-sm">{widget.description}</p>
      ) : null}
      <div className="flex flex-col gap-2">
        <SectionLabel text="Preview" />
        <WidgetPreview
          // A fresh preview per widget: a running one never carries over
          // (and a server widget's Start preview is never skipped).
          key={`${widget.packageId || pkg.id}|${widget.name}`}
          widget={widget}
          appProviders={appProviders}
          getWidgetConfig={getWidgetConfig}
          // A provider create flow for the missing type (Providers page).
          onSetUpProvider={(type, providerClass) =>
            window.dispatchEvent(
              new CustomEvent("dash:open-settings-create-provider", {
                detail: { type, providerClass },
              }),
            )
          }
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Used on" />
          <UsedOn
            usage={pkg.widgetUsage[widget.name] || []}
            workspaces={workspaces}
            onOpenWorkspace={onOpenWorkspace}
            muted={muted}
          />
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Needs providers" />
          {providers.length ? (
            <div className="flex flex-col gap-2">
              {providers.map((p, i) => (
                <div key={`${p.type}-${i}`} className="flex flex-col gap-1">
                  <span className="text-sm">
                    {p.type}
                    {p.providerClass === "mcp" ? " (MCP)" : ""}
                  </span>
                  {p.requiredTools && p.requiredTools.length ? (
                    <span className="flex flex-row flex-wrap gap-1.5">
                      {p.requiredTools.map((t) => (
                        <span
                          key={t}
                          className={`px-1.5 py-0.5 rounded border text-xs font-mono ${hairline} ${muted}`}
                        >
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>None</span>
          )}
        </div>
      </div>
    </div>
  );
};

/** What a ZIP / folder install did. */
const InstallResult = ({ result, onBack, muted }) => (
  <div className="flex flex-col gap-3">
    <span
      className={`flex flex-row items-center gap-2 text-sm ${
        result.status === "error" ? "text-red-400" : ""
      }`}
    >
      <FontAwesomeIcon
        icon={result.status === "error" ? "circle-xmark" : "circle-check"}
        className={
          result.status === "error" ? "text-red-400" : "text-green-400"
        }
      />
      {result.message}
    </span>
    {result.details && result.details.length ? (
      <div className={`flex flex-col gap-1 pl-6 text-xs ${muted}`}>
        {result.details.map((w, i) => (
          <span key={i}>{w.displayName || w.name || String(w)}</span>
        ))}
      </div>
    ) : null}
    <div>
      <Button3 title="Install another" size="sm" onClick={onBack} />
    </div>
  </div>
);

/**
 * WidgetsPage — installed widgets as list + detail, org → package → widgets
 * (app-navigation PRD NAV-008). Packages are the publish/install unit,
 * widgets the placeable unit. Search across packages and widgets, an Org
 * filter, In use / Not used / Mine chips; Update all and Clean up drafts at
 * the page level; package actions Update / Resume / Publish / Open in Finder /
 * Uninstall; New Widget opens the install picker in the detail panel.
 *
 * The list drills in (consolidation Phase 4b): it shows packages, grouped
 * by org; opening one turns the list into that package's widgets, under a
 * header with ← back to all packages, while the right side shows the
 * package (About this package) or the widget picked. A search lists matching
 * packages and widgets flat, each widget with its package.
 */
// The last Create install request (by nonce) the page has run, kept across
// remounts.
const handledInstallRequest = { current: null };

export const WidgetsPage = ({
  workspaces = [],
  credentials = null,
  onOpenWorkspace = null,
  onOpenPrivacySettings = null,
  // { action: "discover" | "zip" | "folder" | "select", nonce, package?,
  // query? } from the Create screen — select opens one of the user's
  // packages; discover can start on a search (the Scout's registry find).
  installRequest = null,
}) => {
  const { muted, strong } = useConfigTokens();
  const { widgets, isLoading, error, uninstallWidget, refresh } =
    useInstalledWidgets();
  const {
    updates,
    packagesWithUpdates,
    isChecking,
    updateWidget,
    updatePackages,
    batchStatus,
    isBatchUpdating,
    isUpdating,
    updateError,
    pendingPreflight,
    resolvePreflight,
  } = useWidgetUpdates(widgets, refresh);
  const { ensureAuthed, authGate } = useRegistryAuthGate();
  const install = useWidgetInstall(refresh);
  const appProviders = (useContext(AppContext) || {}).providers || {};
  const identity = useRegistryIdentity();

  const [query, setQuery] = useState("");
  const [orgFilter, setOrgFilter] = useState([]);
  const [chip, setChip] = useState("all");
  // { packageId, widgetName? } — a package, or one of its widgets.
  const [selection, setSelection] = useState(null);
  // The package the list is inside (null = all packages).
  const [openPkgId, setOpenPkgId] = useState(null);
  // null | "picker" | "discover" | "result"
  const [mode, setMode] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [draftsTarget, setDraftsTarget] = useState(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [updateAllOpen, setUpdateAllOpen] = useState(false);
  const [publishWidget, setPublishWidget] = useState(null);

  const orgs = useMemo(
    () =>
      widgetOrgs(widgets, { workspaces, updates, username: identity.username }),
    [widgets, workspaces, updates, identity.username],
  );
  const shown = filterOrgs(orgs, { query, orgs: orgFilter, chip });
  const visible = shown.flatMap((o) => o.packages);
  const searching = !!query.trim();
  const results = searching
    ? searchResults(orgs, { query, orgs: orgFilter, chip })
    : null;
  // Looked up among every package, not just the filtered ones: a filter
  // never swaps the open package for another.
  const allPkgs = orgs.flatMap((o) => o.packages);
  const openPkg =
    (openPkgId && allPkgs.find((p) => p.id === openPkgId)) || null;
  const selectedPkg =
    (selection && allPkgs.find((p) => p.id === selection.packageId)) || null;
  const selectedWidget =
    selectedPkg && selection.widgetName
      ? selectedPkg.widgets.find((w) => w.name === selection.widgetName) || null
      : null;

  // Into a package (the list becomes its widgets), out of it, or to one of
  // its widgets.
  const openPackage = (pkg) => {
    setMode(null);
    setQuery("");
    setOpenPkgId(pkg.id);
    setSelection({ packageId: pkg.id });
  };
  const openWidgetPage = (pkg, widget) => {
    setMode(null);
    setOpenPkgId(pkg.id);
    setSelection({ packageId: pkg.id, widgetName: widget.name });
  };
  const backToPackages = () => {
    setOpenPkgId(null);
    setSelection(null);
  };
  // A package that's gone (uninstalled elsewhere, renamed) doesn't stay
  // open, or come back open if it's installed again later.
  useEffect(() => {
    if (isLoading) return;
    if (openPkgId && !openPkg) setOpenPkgId(null);
    if (selection && !selectedPkg) setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, openPkgId, !!openPkg, !!selection, !!selectedPkg]);
  const drafts = widgets.filter((w) => w.kind === "draft");
  const orgOptions = orgs.map((o) => ({
    value: o.name,
    label: o.name,
    count: o.packages.length,
  }));

  const pick = async (option) => {
    if (option === "dash-team") {
      // Create › Widget: the Dash team (consolidation Phase 3b).
      setMode(null);
      window.dispatchEvent(
        new CustomEvent("dash:open-create", { detail: { type: "widget" } }),
      );
    } else if (option === "builder") {
      setMode(null);
      openBuilder();
    } else if (option === "discover") {
      setMode("discover");
    } else if (option === "zip" || option === "folder") {
      install.clearResult();
      await (option === "zip"
        ? install.installFromZip()
        : install.loadFolder());
      setMode("result");
    }
  };

  // The Create screen's start-without-AI row: browse the registry, install
  // from a zip or load a folder, right here. Each request runs once — the
  // widget list changes when it installs, and that mustn't run it again
  // (Phase 1a-2: the file picker opened twice). Only "select" waits for
  // the list, until its package is in it. The page remounts on every visit
  // while the request stays set, so "handled" lives outside it (QA
  // 2026-10-22: each visit opened the file picker again).
  const handledRequest = handledInstallRequest;
  useEffect(() => {
    if (!installRequest || !installRequest.action) return;
    if (handledRequest.current === installRequest.nonce) return;
    if (installRequest.action === "select") {
      const want = String(installRequest.package || "").toLowerCase();
      const pkg = orgs
        .flatMap((o) => o.packages)
        .find((p) => String(p.id).toLowerCase() === want);
      setMode(null);
      if (pkg) {
        setQuery("");
        setOpenPkgId(pkg.id);
        setSelection({ packageId: pkg.id });
        handledRequest.current = installRequest.nonce;
      }
      return;
    }
    handledRequest.current = installRequest.nonce;
    pick(installRequest.action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installRequest && installRequest.nonce, widgets.length]);

  // Public packages update signed out; when the registry asks for a
  // sign-in (private, or expired), ask and try once more.
  const updatePackage = async (pkg) => {
    const name = pkg.widgets[0].name;
    try {
      await updateWidget(name, { throwOnError: true });
    } catch (err) {
      if (
        isRegistryAuthError(err) &&
        (await ensureAuthed({
          message: "Sign in to the registry to install this widget update.",
        }))
      ) {
        await updateWidget(name);
      }
    }
  };

  // { pkg, widget? } — widget: the widget page Uninstall was asked from.
  const askRemove = (pkg, widget = null) => setRemoveTarget({ pkg, widget });
  const confirmRemove = async () => {
    const pkg = removeTarget && removeTarget.pkg;
    setRemoveTarget(null);
    if (!pkg) return;
    try {
      if (pkg.isDraft) {
        await Promise.allSettled(
          pkg.widgets.map((w) =>
            w.draftId && window.mainApi?.drafts?.delete
              ? window.mainApi.drafts.delete(w.draftId)
              : uninstallWidget(w.name),
          ),
        );
        await refresh();
      } else {
        // Uninstall is package-level: one widget takes its siblings with it.
        await uninstallWidget(pkg.widgets[0].name);
      }
      if (selection && selection.packageId === pkg.id) setSelection(null);
      if (openPkgId === pkg.id) setOpenPkgId(null);
    } catch (err) {
      console.error("[WidgetsPage] Uninstall error:", err);
    }
  };

  const confirmCleanup = async () => {
    if (isCleaning || !draftsTarget || !draftsTarget.length) return;
    setIsCleaning(true);
    try {
      // Drafts with a metadata row go through drafts:delete; orphaned draft
      // folders (no row) through the regular uninstall.
      await Promise.allSettled(
        draftsTarget.map((d) =>
          d.draftId && window.mainApi?.drafts?.delete
            ? window.mainApi.drafts.delete(d.draftId)
            : uninstallWidget(d.name),
        ),
      );
      await refresh();
    } finally {
      setIsCleaning(false);
      setDraftsTarget(null);
    }
  };

  // A draft's Delete: what goes, and where it's used.
  const draftDeleteMessage = (pkg) => {
    const head = "This permanently deletes the draft and its files.";
    if (!pkg.usedOn.length) return head;
    const names = pkg.usedOn.map((u) => u.workspaceName).join(", ");
    return `${head} It's used on ${plural(
      pkg.usedOn.length,
      "dashboard",
    )} (${names}), which will show it as missing.`;
  };
  const removePkg = removeTarget && removeTarget.pkg;
  const removeCopy =
    removePkg && !removePkg.isDraft
      ? uninstallCopy(removePkg, removeTarget.widget)
      : null;

  let detail;
  if (mode === "picker" || (mode === "result" && !install.result)) {
    detail = <InstallWidgetPicker onSelect={pick} />;
  } else if (mode === "discover") {
    detail = (
      <DiscoverWidgetsDetail
        onBack={() => setMode("picker")}
        initialQuery={
          installRequest && installRequest.action === "discover"
            ? installRequest.query || null
            : null
        }
      />
    );
  } else if (mode === "result") {
    detail = (
      <InstallResult
        result={install.result}
        onBack={() => setMode("picker")}
        muted={muted}
      />
    );
  } else if (selectedPkg && selectedWidget) {
    detail = (
      <WidgetDetail
        key={selectedWidget.name}
        pkg={selectedPkg}
        widget={selectedWidget}
        workspaces={workspaces}
        appProviders={appProviders}
        onOpenWorkspace={onOpenWorkspace}
        onRemove={askRemove}
      />
    );
  } else if (selectedPkg) {
    detail = (
      <PackageDetail
        key={selectedPkg.id}
        pkg={selectedPkg}
        workspaces={workspaces}
        updateError={updateError}
        isUpdating={
          !!isUpdating && selectedPkg.widgets.some((w) => w.name === isUpdating)
        }
        onOpenWorkspace={onOpenWorkspace}
        onOpenPrivacySettings={onOpenPrivacySettings}
        onUpdate={updatePackage}
        onPublish={(pkg) => setPublishWidget(pkg.widgets[0])}
        onRemove={(pkg) => askRemove(pkg)}
        identity={identity}
      />
    );
  } else if (isLoading || error || !widgets.length) {
    detail = (
      <span className={`text-sm ${muted}`}>
        {isLoading
          ? "Loading widgets…"
          : error
            ? `Couldn't load widgets: ${error}`
            : "No widgets installed yet."}
      </span>
    );
  } else {
    // Nothing open yet: the whole picture (Phase 4b — opening the first
    // package by itself would swap the list before anything was picked).
    const totals = widgetTotals(orgs);
    detail = (
      <div className="flex flex-col gap-5" data-testid="widgets-summary">
        <h3 className={`text-lg font-semibold ${strong}`}>Your widgets</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-2 min-w-0">
            <SectionLabel text="Installed" />
            <span className="text-sm">
              {`${plural(totals.packages, "package")} · ${plural(
                totals.widgets,
                "widget",
              )}`}
            </span>
          </div>
          <div className="flex flex-col gap-2 min-w-0">
            <SectionLabel text="In use" />
            <span className="text-sm">
              {totals.inUse
                ? `${plural(totals.inUse, "widget")} on ${plural(
                    totals.dashboards,
                    "dashboard",
                  )}`
                : "None on a dashboard yet"}
            </span>
          </div>
          {totals.updates ? (
            <div className="flex flex-col gap-2 min-w-0">
              <SectionLabel text="Updates" />
              <span className="text-sm">
                {`${plural(totals.updates, "package")} ${
                  totals.updates === 1 ? "has" : "have"
                } an update`}
              </span>
            </div>
          ) : null}
        </div>
        <span className={`text-sm ${muted}`}>
          Open a package on the left to see its widgets.
        </span>
      </div>
    );
  }

  // A package's row (it opens), and a widget's row.
  const packageRow = (pkg) => {
    const label = packageLabel(pkg);
    return (
      <ListRow
        key={pkg.id}
        testId="package-row"
        icon={<FontAwesomeIcon icon="box" className="h-3.5 w-3.5" />}
        ariaLabel={`${label}: ${plural(pkg.widgets.length, "widget")}`}
        // Badges sit in the title: ListRow's trailing slot only shows on
        // hover.
        title={
          <span className="flex flex-row items-center gap-1.5 min-w-0">
            <span className="truncate">{label}</span>
            {pkg.update ? (
              <span data-testid="package-update">
                <StatusBadge state="info" compact label="Update" />
              </span>
            ) : null}
            {failedChecks(pkg) ? (
              <span data-testid="package-checks-failed">
                <StatusBadge
                  state="warning"
                  compact
                  label="Didn't pass checks"
                />
              </span>
            ) : null}
          </span>
        }
        meta={`${plural(pkg.widgets.length, "widget")}${
          pkg.version ? ` · v${pkg.version}` : ""
        }`}
        onClick={() => openPackage(pkg)}
      />
    );
  };
  const widgetRow = (pkg, w, meta) => (
    <ListRow
      key={`${pkg.id}:${w.name}`}
      testId="widget-row"
      icon={
        <FontAwesomeIcon icon={resolveIcon(w.icon)} className="h-3.5 w-3.5" />
      }
      title={widgetTitle(w)}
      meta={meta}
      selected={
        !mode &&
        !!selectedWidget &&
        selectedPkg.id === pkg.id &&
        selectedWidget.name === w.name
      }
      onClick={() => openWidgetPage(pkg, w)}
    />
  );

  return (
    <ManageLayout
      testId="widgets-page"
      listLabel="Widgets"
      detailTestId="widget-detail"
      toolbar={
        <>
          <div className="w-72">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search packages or widgets…"
            />
          </div>
          <FilterMenu
            label="Org"
            options={orgOptions}
            selected={orgFilter}
            onChange={setOrgFilter}
          />
          <SegmentedControl
            ariaLabel="Show"
            options={CHIPS}
            value={chip}
            onChange={setChip}
          />
          <span className="flex-1" />
          {isChecking && !packagesWithUpdates.length ? (
            <span className={`text-sm ${muted}`}>Checking for updates…</span>
          ) : null}
          {packagesWithUpdates.length ? (
            <Button
              title={`${plural(packagesWithUpdates.length, "update")} · Update all`}
              size="sm"
              onClick={() => setUpdateAllOpen(true)}
            />
          ) : null}
          {drafts.length ? (
            <Button3
              title={`Clean up ${plural(drafts.length, "draft")}`}
              size="sm"
              onClick={() => setDraftsTarget(drafts)}
            />
          ) : null}
        </>
      }
      list={
        searching ? (
          // A search: one flat list — packages, then widgets wherever they
          // live, each saying its package.
          <>
            {results.packages.length ? (
              <div className="flex flex-col gap-0.5">
                <ListGroupLabel text="Packages" testId="search-heading" />
                {results.packages.map((pkg) => packageRow(pkg))}
              </div>
            ) : null}
            {results.widgets.length ? (
              <div className="flex flex-col gap-0.5">
                <ListGroupLabel text="Widgets" testId="search-heading" />
                {results.widgets.map(({ pkg, widget }) =>
                  widgetRow(pkg, widget, `in ${packageLabel(pkg)}`),
                )}
              </div>
            ) : null}
            {!results.packages.length && !results.widgets.length ? (
              <span className={`text-sm px-2 ${muted}`}>
                No widgets match &ldquo;{query.trim()}&rdquo;.
              </span>
            ) : null}
          </>
        ) : openPkg ? (
          // Inside a package: its widgets, under a header that's the
          // package (design guide: a nested view's title is what you opened).
          <div className="flex flex-col gap-0.5" data-testid="package-widgets">
            <PanelHeader
              testId="package-header"
              title={packageLabel(openPkg)}
              onBack={backToPackages}
              backLabel="All packages"
            />
            <ListRow
              testId="package-about"
              icon={<FontAwesomeIcon icon="box" className="h-3.5 w-3.5" />}
              title="About this package"
              meta={
                openPkg.isBuiltIn
                  ? openPkg.source
                  : `${openPkg.id}${openPkg.version ? ` · v${openPkg.version}` : ""}`
              }
              selected={
                !mode &&
                !!selection &&
                selection.packageId === openPkg.id &&
                !selectedWidget
              }
              onClick={() => {
                setMode(null);
                setSelection({ packageId: openPkg.id });
              }}
            />
            {(() => {
              const list = packageWidgets(openPkg, chip);
              return (
                <>
                  <ListGroupLabel
                    text={plural(list.length, "widget")}
                    testId="package-widgets-heading"
                  />
                  {list.map((w) => {
                    const used = (openPkg.widgetUsage[w.name] || []).length;
                    return widgetRow(
                      openPkg,
                      w,
                      used ? `On ${plural(used, "dashboard")}` : "Not used",
                    );
                  })}
                  {!list.length ? (
                    <span className={`text-sm px-2 ${muted}`}>
                      {`No widgets in ${packageLabel(openPkg)} match ${chipLabel(chip)}.`}
                    </span>
                  ) : null}
                </>
              );
            })()}
          </div>
        ) : (
          <>
            {shown.map((org) => (
              <div key={org.name} className="flex flex-col gap-0.5">
                <ListGroupLabel text={org.name} testId="org-heading" />
                {org.packages.map((pkg) => packageRow(pkg))}
              </div>
            ))}
            {!visible.length && !isLoading ? (
              <span className={`text-sm px-2 ${muted}`}>No widgets match.</span>
            ) : null}
          </>
        )
      }
      detail={detail}
    >
      <ConfirmationModal
        isOpen={!!removeTarget}
        setIsOpen={() => setRemoveTarget(null)}
        title={
          removePkg && removePkg.isDraft
            ? "Delete draft?"
            : removeCopy
              ? removeCopy.title
              : ""
        }
        message={
          removePkg && removePkg.isDraft ? draftDeleteMessage(removePkg) : null
        }
        confirmLabel={removePkg && removePkg.isDraft ? "Delete" : "Uninstall"}
        variant="danger"
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      >
        {removeCopy ? (
          <div
            className="flex flex-col gap-2 text-sm"
            data-testid="uninstall-copy"
          >
            <span>{removeCopy.intro}</span>
            {removeCopy.items.length ? (
              <ul className="flex flex-col gap-0.5 pl-4 list-disc">
                {removeCopy.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {removeCopy.note ? (
              <span className={muted}>{removeCopy.note}</span>
            ) : null}
          </div>
        ) : null}
      </ConfirmationModal>
      <ConfirmationModal
        isOpen={!!draftsTarget}
        setIsOpen={(open) => {
          // Don't close mid-delete — a partial cleanup would look done.
          if (isCleaning) return;
          if (!open) setDraftsTarget(null);
        }}
        title="Clean up drafts?"
        message={
          draftsTarget
            ? `This permanently deletes ${plural(
                draftsTarget.length,
                "in-progress widget",
              )} and their files: ${draftsTarget
                .map((d) => d.displayName || d.name)
                .join(", ")}. This can't be undone.`
            : ""
        }
        confirmLabel={
          isCleaning
            ? "Deleting…"
            : `Delete ${plural((draftsTarget || []).length, "draft")}`
        }
        variant="danger"
        onConfirm={confirmCleanup}
        onCancel={() => {
          if (!isCleaning) setDraftsTarget(null);
        }}
      />
      <InstallProgressModal
        isOpen={install.progress.open}
        setIsOpen={(open) => {
          if (!open) install.closeProgress();
        }}
        widgets={install.progress.widgets}
        isComplete={install.progress.complete}
        action={install.progress.action}
        onDone={install.closeProgress}
      />
      {/* A ZIP whose package is installed already (Phase 1a-2). */}
      <ConfirmationModal
        isOpen={!!install.replace}
        setIsOpen={(open) => {
          if (!open) install.cancelReplace();
        }}
        title="Replace the installed package?"
        message={
          install.replace
            ? `${install.replace.name} is already installed. Replace it with the one in this file? Its widgets on your dashboards will use the new code.`
            : ""
        }
        confirmLabel="Replace it"
        onConfirm={install.confirmReplace}
        onCancel={install.cancelReplace}
      />
      {publishWidget ? (
        <PublishWidgetModal
          isOpen={!!publishWidget}
          setIsOpen={(open) => {
            if (!open) {
              setPublishWidget(null);
              // A publish just happened (maybe): update "Published v…".
              identity.refresh();
            }
          }}
          appId={credentials?.appId}
          widget={publishWidget}
        />
      ) : null}
      <UpdateAllWidgetsModal
        isOpen={updateAllOpen}
        setIsOpen={setUpdateAllOpen}
        packages={packagesWithUpdates}
        batchStatus={batchStatus}
        isBatchUpdating={isBatchUpdating}
        onConfirm={async (names) => {
          // Public packages update signed out. Rows the registry refused
          // for a sign-in get one more try after signing in.
          const first = await updatePackages(names);
          const refused = ((first && first.failedDetails) || [])
            .filter((d) => isRegistryAuthError(d.error))
            .map((d) => d.name);
          if (
            !refused.length ||
            !(await ensureAuthed({
              message: "Sign in to the registry to install widget updates.",
            }))
          ) {
            return first;
          }
          const again = await updatePackages(refused, { keepStatus: true });
          return {
            succeeded: [...(first.succeeded || []), ...(again.succeeded || [])],
            failed: (first.failed || [])
              .filter((n) => !refused.includes(n))
              .concat(again.failed || []),
            failedDetails: (first.failedDetails || [])
              .filter((d) => !refused.includes(d.name))
              .concat(again.failedDetails || []),
          };
        }}
      />
      {/* Permission consent for a batch update that asks for new access. */}
      <Modal
        isOpen={!!pendingPreflight}
        setIsOpen={(open) => {
          if (!open && typeof resolvePreflight === "function") {
            resolvePreflight(null);
          }
        }}
      >
        <WidgetPreflightReview
          pendingPreflight={pendingPreflight}
          resolvePreflight={resolvePreflight}
        />
      </Modal>
      {/* Last, so the sign-in modal stacks above the update modal. */}
      {authGate}
    </ManageLayout>
  );
};

export default WidgetsPage;

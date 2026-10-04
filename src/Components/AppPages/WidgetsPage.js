import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Button3,
  ConfirmationModal,
  FilterMenu,
  FontAwesomeIcon,
  Modal,
  SearchInput,
  SectionLabel,
  SegmentedControl,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { WidgetPreview } from "./WidgetPreview";
import { useInstalledWidgets } from "../../hooks/useInstalledWidgets";
import { useWidgetUpdates } from "../../hooks/useWidgetUpdates";
import { useRegistryAuthGate } from "../../hooks/useRegistryAuthGate";
import { resolveIcon } from "../../utils/resolveIcon";
import { getUserConfigurableProviders } from "../../utils/providerUtils";
import { WidgetPreflightReview } from "../WidgetPreflightReview";
import { InstallWidgetPicker } from "../Settings/details/InstallWidgetPicker";
import { DiscoverWidgetsDetail } from "../Settings/details/DiscoverWidgetsDetail";
import { InstallProgressModal } from "../Settings/details/InstallProgressModal";
import { PublishWidgetModal } from "../Settings/details/PublishWidgetModal";
import { UpdateAllWidgetsModal } from "../Settings/sections/UpdateAllWidgetsModal";
import { useWidgetInstall } from "./useWidgetInstall";
import { filterOrgs, packageLabel, widgetOrgs } from "./widgetSummary";

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

const openBuilder = (detail) =>
  window.dispatchEvent(
    detail
      ? new CustomEvent("dash:open-widget-builder", { detail })
      : new Event("dash:open-widget-builder"),
  );

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
                size="xs"
                onClick={() => onOpenWorkspace(ws)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/** A package's details (the right-hand panel). */
const PackageDetail = ({
  pkg,
  workspaces,
  updateError,
  isUpdating,
  onSelectWidget,
  onOpenWorkspace,
  onOpenPrivacySettings,
  onUpdate,
  onPublish,
  onRemove,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const first = pkg.widgets[0] || {};
  const installed = !pkg.isBuiltIn && !pkg.isDraft;
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
          {installed ? (
            <Button3
              title="Publish…"
              size="sm"
              onClick={() => onPublish(pkg)}
            />
          ) : null}
          {!pkg.isBuiltIn && first.path ? (
            <Button3
              title="Open in Finder"
              size="sm"
              onClick={() => window.mainApi?.shell?.openPath(first.path)}
            />
          ) : null}
          {pkg.isBuiltIn ? null : (
            <Button3
              title={pkg.isDraft ? "Delete" : "Uninstall"}
              size="sm"
              onClick={() => onRemove(pkg)}
            />
          )}
        </div>
      </div>
      {updateError && installed && pkg.update ? (
        <span className="text-xs text-red-400">{updateError}</span>
      ) : null}
      {pkg.description ? <p className="text-sm">{pkg.description}</p> : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel
            text={`${plural(pkg.widgets.length, "widget")} in this package`}
          />
          <div className="flex flex-col gap-1">
            {pkg.widgets.map((w) => {
              const used = (pkg.widgetUsage[w.name] || []).length;
              return (
                <div
                  key={w.name}
                  className={`rounded-md px-2 py-1.5 border flex flex-row items-center justify-between gap-3 ${hairline}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectWidget(w.name)}
                    className="flex-1 min-w-0 text-left text-sm truncate"
                  >
                    {w.displayName || w.name}
                  </button>
                  <span className={`text-xs flex-shrink-0 ${muted}`}>
                    {used ? `on ${plural(used, "dashboard")}` : "not used"}
                  </span>
                  {pkg.isBuiltIn ? null : (
                    <Button3
                      title="Preview"
                      size="xs"
                      onClick={() => onSelectWidget(w.name)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
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
                  size="xs"
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

/** One widget's details, with a way back to its package. */
const WidgetDetail = ({
  pkg,
  widget,
  workspaces,
  appProviders,
  onBack,
  onOpenWorkspace,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const providers = getUserConfigurableProviders(widget.providers);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button3 title={`← ${packageLabel(pkg)}`} size="xs" onClick={onBack} />
      </div>
      <div className="flex flex-row items-center gap-3 min-w-0">
        <span
          className={`flex items-center justify-center h-10 w-10 rounded-lg border flex-shrink-0 ${hairline}`}
        >
          <FontAwesomeIcon icon={resolveIcon(widget.icon)} />
        </span>
        <div className="flex flex-col gap-0.5 min-w-0">
          <h3 className={`text-lg font-semibold truncate ${strong}`}>
            {widget.displayName || widget.name}
          </h3>
          <span className={`text-xs font-mono truncate ${muted}`}>
            {widget.name}
          </span>
        </div>
      </div>
      {widget.description ? (
        <p className="text-sm">{widget.description}</p>
      ) : null}
      <div className="flex flex-col gap-2">
        <SectionLabel text="Preview" />
        <WidgetPreview
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
 */
export const WidgetsPage = ({
  workspaces = [],
  credentials = null,
  onOpenWorkspace = null,
  onOpenPrivacySettings = null,
  createRequested = false,
  onCreateAcknowledged = null,
}) => {
  const { muted, strong, hairline, selectedBg, selectedBorder } =
    useConfigTokens();
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

  const [query, setQuery] = useState("");
  const [orgFilter, setOrgFilter] = useState([]);
  const [chip, setChip] = useState("all");
  // { packageId, widgetName? } — a package, or one of its widgets.
  const [selection, setSelection] = useState(null);
  // null | "picker" | "discover" | "result"
  const [mode, setMode] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [draftsTarget, setDraftsTarget] = useState(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [updateAllOpen, setUpdateAllOpen] = useState(false);
  const [publishWidget, setPublishWidget] = useState(null);

  const orgs = useMemo(
    () => widgetOrgs(widgets, { workspaces, updates }),
    [widgets, workspaces, updates],
  );
  const shown = filterOrgs(orgs, { query, orgs: orgFilter, chip });
  const visible = shown.flatMap((o) => o.packages);
  const selectedPkg =
    (selection && visible.find((p) => p.id === selection.packageId)) ||
    visible[0] ||
    null;
  const selectedWidget =
    selectedPkg && selection && selection.packageId === selectedPkg.id
      ? selectedPkg.widgets.find((w) => w.name === selection.widgetName) || null
      : null;
  const drafts = widgets.filter((w) => w.kind === "draft");
  const orgOptions = orgs.map((o) => ({
    value: o.name,
    label: o.name,
    count: o.packages.length,
  }));

  // The header's New Widget opens the install picker in the detail panel.
  const prevCreate = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreate.current) setMode("picker");
    prevCreate.current = createRequested;
    if (createRequested && onCreateAcknowledged) onCreateAcknowledged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  const pick = async (option) => {
    if (option === "builder") {
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

  const updatePackage = async (pkg) => {
    const ok = await ensureAuthed({
      message: "Sign in to the registry to install this widget update.",
    });
    if (!ok) return;
    await updateWidget(pkg.widgets[0].name);
  };

  const confirmRemove = async () => {
    const pkg = removeTarget;
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

  const removeMessage = (pkg) => {
    if (!pkg) return "";
    const n = pkg.widgets.length;
    const head = pkg.isDraft
      ? `This permanently deletes the draft and its files.`
      : `This removes its ${plural(n, "widget")}.`;
    if (!pkg.usedOn.length) return head;
    const names = pkg.usedOn.map((u) => u.workspaceName).join(", ");
    return `${head} ${n === 1 ? "It's" : "They're"} used on ${plural(
      pkg.usedOn.length,
      "dashboard",
    )} (${names}), which will show ${n === 1 ? "it" : "them"} as missing.`;
  };

  let detail;
  if (mode === "picker" || (mode === "result" && !install.result)) {
    detail = <InstallWidgetPicker onSelect={pick} />;
  } else if (mode === "discover") {
    detail = <DiscoverWidgetsDetail onBack={() => setMode("picker")} />;
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
        onBack={() => setSelection({ packageId: selectedPkg.id })}
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
        onSelectWidget={(name) =>
          setSelection({ packageId: selectedPkg.id, widgetName: name })
        }
        onOpenWorkspace={onOpenWorkspace}
        onOpenPrivacySettings={onOpenPrivacySettings}
        onUpdate={updatePackage}
        onPublish={(pkg) => setPublishWidget(pkg.widgets[0])}
        onRemove={setRemoveTarget}
      />
    );
  } else {
    detail = (
      <span className={`text-sm ${muted}`}>
        {isLoading
          ? "Loading widgets…"
          : error
            ? `Couldn't load widgets: ${error}`
            : widgets.length
              ? "No widgets match these filters."
              : "No widgets installed yet."}
      </span>
    );
  }

  return (
    // The page's base text colour (plain names inherit it); muted text
    // keeps its own token.
    <div
      data-testid="widgets-page"
      className={`flex flex-col flex-1 min-h-0 gap-3 px-6 pt-4 pb-4 ${strong}`}
    >
      {/* Filter bar — fixed; the list and detail scroll on their own. */}
      <div className="flex-shrink-0 flex flex-row flex-wrap items-center gap-2">
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
          <span className={`text-xs ${muted}`}>Checking for updates…</span>
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
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
        <div
          role="list"
          aria-label="Widgets"
          className="min-h-0 overflow-y-auto flex flex-col gap-3 pr-2"
        >
          {shown.map((org) => (
            <div key={org.name} className="flex flex-col gap-1">
              <span data-testid="org-heading" className="px-3">
                <SectionLabel text={org.name} />
              </span>
              {org.packages.map((pkg) => {
                const isSel = !mode && selectedPkg && pkg.id === selectedPkg.id;
                const active = isSel && !selectedWidget;
                const expanded = isSel || pkg.queryMatchedWidgets;
                const label = packageLabel(pkg);
                return (
                  <div key={pkg.id} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      data-package={label}
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        setMode(null);
                        setSelection({ packageId: pkg.id });
                      }}
                      className={`w-full text-left rounded-lg px-3 py-2 border flex flex-row items-center gap-3 ${
                        active
                          ? `${selectedBg} ${selectedBorder}`
                          : "border-transparent"
                      }`}
                    >
                      <span
                        className={`flex items-center justify-center h-7 w-7 rounded-md border flex-shrink-0 ${hairline}`}
                      >
                        <FontAwesomeIcon icon="box" />
                      </span>
                      <span className="flex-1 min-w-0 flex flex-col">
                        <span
                          className={`text-sm font-medium truncate ${strong}`}
                        >
                          {label}
                        </span>
                        <span className={`text-xs truncate ${muted}`}>
                          {plural(pkg.widgets.length, "widget")}
                          {pkg.version ? ` · v${pkg.version}` : ""}
                        </span>
                      </span>
                      {pkg.update ? (
                        <span
                          data-testid="package-update"
                          title={`Update to v${pkg.update.latestVersion}`}
                          className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0"
                        />
                      ) : null}
                    </button>
                    {expanded
                      ? // Search results show only the widgets that matched.
                        pkg.matched.map((w) => {
                          const wActive =
                            isSel &&
                            selectedWidget &&
                            selectedWidget.name === w.name;
                          return (
                            <button
                              key={w.name}
                              type="button"
                              aria-current={wActive ? "true" : undefined}
                              onClick={() => {
                                setMode(null);
                                setSelection({
                                  packageId: pkg.id,
                                  widgetName: w.name,
                                });
                              }}
                              className={`w-full text-left rounded-md pl-10 pr-3 py-1.5 border text-sm truncate ${
                                wActive
                                  ? `${selectedBg} ${selectedBorder}`
                                  : "border-transparent"
                              }`}
                            >
                              {w.displayName || w.name}
                            </button>
                          );
                        })
                      : null}
                  </div>
                );
              })}
            </div>
          ))}
          {!visible.length && !isLoading ? (
            <span className={`text-sm px-3 ${muted}`}>No widgets match.</span>
          ) : null}
        </div>
        <div
          data-testid="widget-detail"
          className={`col-span-2 min-h-0 overflow-y-auto rounded-lg border p-5 ${hairline}`}
        >
          {detail}
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!removeTarget}
        setIsOpen={() => setRemoveTarget(null)}
        title={
          removeTarget && removeTarget.isDraft
            ? "Delete draft?"
            : `Uninstall ${removeTarget ? packageLabel(removeTarget) : ""}?`
        }
        message={removeMessage(removeTarget)}
        confirmLabel={
          removeTarget && removeTarget.isDraft ? "Delete" : "Uninstall"
        }
        variant="danger"
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
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
        onDone={install.closeProgress}
      />
      {publishWidget ? (
        <PublishWidgetModal
          isOpen={!!publishWidget}
          setIsOpen={(open) => {
            if (!open) setPublishWidget(null);
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
          // Check the session first so an expired token shows the sign-in
          // gate instead of failing every row.
          if (
            !(await ensureAuthed({
              message: "Sign in to the registry to install widget updates.",
            }))
          )
            return { succeeded: [], failed: [], cancelled: true };
          return updatePackages(names);
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
    </div>
  );
};

export default WidgetsPage;

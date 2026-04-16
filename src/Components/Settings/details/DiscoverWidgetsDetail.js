import React, {
  useState,
  useEffect,
  useCallback,
  useContext,
  useRef,
} from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  SearchInput,
  Sidebar,
  Button,
  Paragraph,
  ConfirmationModal,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { ComponentManager } from "../../../ComponentManager";
import { RegistryPackageDetail } from "./RegistryPackageDetail";
import { RegistryAuthModal } from "../../Registry/RegistryAuthModal";
import { RegistrySignInBanner } from "../../Registry/RegistrySignInBanner";
import { InstallProgressModal } from "./InstallProgressModal";
import { useRegistrySearch } from "../../../hooks/useRegistrySearch";

/**
 * DiscoverWidgetsDetail — registry browser that lives inside the detail panel.
 *
 * Contains a back button, search input, scrollable package list, and when a
 * package is selected shows RegistryPackageDetail inline.
 */
export const DiscoverWidgetsDetail = ({ onBack }) => {
  const { currentTheme } = useContext(ThemeContext);
  const appContext = useContext(AppContext);
  const providers = appContext?.providers || {};
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const {
    packages,
    flatWidgets,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    isInstalling,
    installError,
    needsAuth,
    clearNeedsAuth,
    installPackage,
    retry,
    showAllPackages,
    setShowAllPackages,
  } = useRegistrySearch();

  const [selectedPackageName, setSelectedPackageName] = useState(null);
  const [toolConflictWarning, setToolConflictWarning] = useState(null);

  // Auth state — used to nudge unauthenticated users toward signing in
  // when the empty state appears (so they realize private packages are
  // hidden behind auth).
  const [registryAuthed, setRegistryAuthed] = useState(null);
  const [showAuthFromEmpty, setShowAuthFromEmpty] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await window.mainApi?.registryAuth?.getStatus();
        if (!cancelled) setRegistryAuthed(!!status?.authenticated);
      } catch {
        if (!cancelled) setRegistryAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsAuth, showAuthFromEmpty]);

  // Install progress modal state
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressWidgets, setProgressWidgets] = useState([]);
  const [progressComplete, setProgressComplete] = useState(false);
  const installActiveRef = useRef(false);
  const pendingInstallRef = useRef(null);

  // Track installed package names (same pattern as WidgetSidebar)
  const [installedPackageNames, setInstalledPackageNames] = useState(new Set());

  const loadInstalledPackages = useCallback(async () => {
    try {
      const widgets = await window.mainApi.widgets.list();
      const names = new Set();
      for (const w of widgets) {
        if (w.name) names.add(w.name);
        if (w.path) {
          const folderName = w.path.split("/").pop();
          if (folderName) names.add(folderName);
        }
        if (w.author && w.name) {
          names.add(`${w.author}/${w.name}`);
        }
        if (w.author && w.path) {
          const folderName = w.path.split("/").pop();
          if (folderName) names.add(`${w.author}/${folderName}`);
        }
      }
      setInstalledPackageNames(names);
    } catch (err) {
      console.error(
        "[DiscoverWidgetsDetail] Error loading installed widgets:",
        err,
      );
    }
  }, []);

  useEffect(() => {
    loadInstalledPackages();
    const handleWidgetsUpdated = () => loadInstalledPackages();
    window.addEventListener("dash:widgets-updated", handleWidgetsUpdated);
    return () =>
      window.removeEventListener("dash:widgets-updated", handleWidgetsUpdated);
  }, [loadInstalledPackages]);

  // Watch for install completion — same pattern as WidgetSidebar
  useEffect(() => {
    if (!installActiveRef.current) return;
    if (isInstalling) return; // Still in progress

    installActiveRef.current = false;

    if (needsAuth) {
      // Auth needed — close progress modal, auth modal will handle it
      setShowProgressModal(false);
      return;
    }

    if (installError) {
      setProgressWidgets((prev) =>
        prev.map((w) => ({
          ...w,
          status: "failed",
          error: installError,
        })),
      );
    } else {
      setProgressWidgets((prev) =>
        prev.map((w) => ({ ...w, status: "installed" })),
      );
    }
    setProgressComplete(true);
  }, [isInstalling, needsAuth, installError]);

  const handleProgressDone = useCallback(() => {
    setShowProgressModal(false);
    setProgressWidgets([]);
    setProgressComplete(false);
    pendingInstallRef.current = null;
  }, []);

  const isPackageInstalled = useCallback(
    (pkg) => {
      if (
        installedPackageNames.has(pkg.name) ||
        (pkg.scope && installedPackageNames.has(`${pkg.scope}/${pkg.name}`))
      ) {
        return true;
      }
      const packageWidgets = pkg.widgets || [];
      if (packageWidgets.length > 0) {
        const cMap = ComponentManager.componentMap();
        const cMapKeys = Object.keys(cMap);
        return packageWidgets.some(
          (w) =>
            w.name in cMap ||
            cMapKeys.some((k) => k === w.name || k.endsWith(`_${w.name}`)),
        );
      }
      return false;
    },
    [installedPackageNames],
  );

  const selectedWidget = selectedPackageName
    ? flatWidgets.find((w) => w.packageName === selectedPackageName)
    : null;

  // Check if widget's requiredTools conflict with user's provider allowedTools
  const checkToolConflicts = (widget) => {
    const conflicts = [];
    const packageWidgets = widget.packageWidgets || [];
    for (const w of packageWidgets) {
      for (const p of w.providers || []) {
        if (!p.requiredTools?.length || p.providerClass !== "mcp") continue;
        // Find matching user provider
        const matchingProviders = Object.entries(providers).filter(
          ([, prov]) =>
            prov.type === p.type &&
            prov.providerClass === "mcp" &&
            prov.allowedTools,
        );
        for (const [provName, prov] of matchingProviders) {
          const blocked = p.requiredTools.filter(
            (t) => !prov.allowedTools.includes(t),
          );
          if (blocked.length > 0) {
            conflicts.push({
              widgetName: w.displayName || w.name,
              providerName: provName,
              blockedTools: blocked,
            });
          }
        }
      }
    }
    return conflicts;
  };

  const startInstallWithProgress = useCallback(
    (widget) => {
      const pkg = packages.find((p) => p.name === widget.packageName);
      const widgetList = pkg?.widgets || [];
      const items = widgetList.map((w) => ({
        packageName: widget.packageName,
        displayName: w.displayName || w.name,
        status: "pending",
      }));
      if (items.length === 0) {
        items.push({
          packageName: widget.packageName,
          displayName: widget.packageDisplayName || widget.packageName,
          status: "pending",
        });
      }

      pendingInstallRef.current = widget;
      setProgressWidgets(items);
      setProgressComplete(false);
      setShowProgressModal(true);
      installActiveRef.current = true;

      // Transition to downloading
      setProgressWidgets((prev) =>
        prev.map((w) => ({ ...w, status: "downloading" })),
      );

      installPackage(widget);
    },
    [packages, installPackage],
  );

  const handleInstall = () => {
    if (!selectedWidget) return;

    const conflicts = checkToolConflicts(selectedWidget);
    if (conflicts.length > 0) {
      setToolConflictWarning(conflicts);
    } else {
      startInstallWithProgress(selectedWidget);
    }
  };

  const handleConfirmInstall = () => {
    setToolConflictWarning(null);
    if (selectedWidget) {
      startInstallWithProgress(selectedWidget);
    }
  };

  // If a package is selected, show its detail inline
  if (selectedWidget) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Back to package list */}
        <div className="flex-shrink-0 px-4 pt-4">
          <button
            type="button"
            onClick={() => setSelectedPackageName(null)}
            className="flex items-center gap-1.5 text-sm opacity-60 hover:opacity-100 transition-opacity"
          >
            <FontAwesomeIcon icon="arrow-left" className="h-3 w-3" />
            <span>Back</span>
          </button>
        </div>

        <RegistryPackageDetail
          widget={selectedWidget}
          onInstall={handleInstall}
          isInstalling={isInstalling}
          installError={installError}
          isInstalled={
            selectedWidget
              ? isPackageInstalled(
                  packages.find((p) => p.name === selectedPackageName) || {},
                )
              : false
          }
        />

        <InstallProgressModal
          isOpen={showProgressModal}
          setIsOpen={setShowProgressModal}
          widgets={progressWidgets}
          isComplete={progressComplete}
          onDone={handleProgressDone}
        />

        <RegistryAuthModal
          isOpen={needsAuth}
          setIsOpen={(open) => {
            if (!open) clearNeedsAuth();
          }}
          onAuthenticated={() => {
            clearNeedsAuth();
            if (pendingInstallRef.current)
              startInstallWithProgress(pendingInstallRef.current);
          }}
          onCancel={clearNeedsAuth}
          message="Sign in to install this widget from the Dash Registry."
        />

        <RegistryAuthModal
          isOpen={showAuthFromEmpty}
          setIsOpen={setShowAuthFromEmpty}
          onAuthenticated={() => {
            setShowAuthFromEmpty(false);
            setRegistryAuthed(true);
            // Trigger a refresh of the list now that the user can see
            // their private packages.
            retry();
          }}
          onCancel={() => setShowAuthFromEmpty(false)}
          message="Sign in to see your private packages and install widgets you've published."
        />
      </div>
    );
  }

  // Package list view
  let listBody;

  if (isLoading) {
    listBody = (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-3"></div>
          <Paragraph className="text-sm opacity-50">
            Loading registry...
          </Paragraph>
        </div>
      </div>
    );
  } else if (error) {
    listBody = (
      <div className="px-4 py-8 text-center">
        <Paragraph className="text-sm text-red-400 mb-3">{error}</Paragraph>
        <Button
          title="Retry"
          bgColor="bg-gray-700"
          hoverBackgroundColor="hover:bg-gray-600"
          textSize="text-sm"
          padding="py-1 px-3"
          onClick={retry}
        />
      </div>
    );
  } else if (packages.length === 0) {
    listBody = (
      <div className="px-4 py-8 text-center">
        <Paragraph className="text-sm opacity-50">
          {searchQuery
            ? "No packages match your search."
            : "No packages available."}
        </Paragraph>
      </div>
    );
  } else {
    listBody = (
      <div className="space-y-1">
        {packages.map((pkg) => {
          const widgetCount = (pkg.widgets || []).length;
          // Check if this package has incompatible API dependencies
          const pkgWidget = flatWidgets.find((w) => w.packageName === pkg.name);
          const hasIncompatible =
            pkgWidget?.missingApis && pkgWidget.missingApis.length > 0;
          const isInstalled = isPackageInstalled(pkg);
          return (
            <Sidebar.Item
              key={pkg.name}
              icon={
                <FontAwesomeIcon
                  icon={hasIncompatible ? "triangle-exclamation" : "cube"}
                  className={`h-3.5 w-3.5 ${hasIncompatible ? "text-yellow-500" : ""}`}
                />
              }
              onClick={() => setSelectedPackageName(pkg.name)}
              badge={`${widgetCount}`}
              className={isInstalled ? "opacity-50" : ""}
            >
              <span className="flex items-center gap-1.5">
                {pkg.displayName || pkg.name}
                {isInstalled && (
                  <span className="text-[10px] text-emerald-400">
                    Installed
                  </span>
                )}
              </span>
            </Sidebar.Item>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 ${
        panelStyles.textColor || "text-gray-200"
      }`}
    >
      {/* Back button */}
      <div className="flex-shrink-0 px-4 pt-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm opacity-60 hover:opacity-100 transition-opacity"
        >
          <FontAwesomeIcon icon="arrow-left" className="h-3 w-3" />
          <span>Back</span>
        </button>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-4 py-3">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search packages..."
          inputClassName="py-1.5 text-xs"
        />
        <label className="flex items-center gap-1.5 mt-2 text-xs opacity-50 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAllPackages}
            onChange={(e) => setShowAllPackages(e.target.checked)}
            className="rounded"
          />
          Show all packages
        </label>
      </div>

      {/* Sign-in nudge — persistent above the list while unauthenticated */}
      <RegistrySignInBanner
        visible={registryAuthed === false}
        onSignIn={() => setShowAuthFromEmpty(true)}
        noun="widget"
      />

      {/* Package list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2">{listBody}</div>

      {/* Summary footer */}
      {!isLoading && !error && packages.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 text-[10px] opacity-40 border-t border-white/10">
          {packages.length} package
          {packages.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Tool conflict warning modal */}
      <ConfirmationModal
        isOpen={!!toolConflictWarning}
        setIsOpen={() => setToolConflictWarning(null)}
        title="Tool Access Conflict"
        message={
          toolConflictWarning
            ? `This widget requires tools that are blocked by your provider settings:\n\n${toolConflictWarning
                .map(
                  (c) =>
                    `• ${c.widgetName} needs ${c.blockedTools.join(", ")} (blocked by "${c.providerName}")`,
                )
                .join(
                  "\n",
                )}\n\nYou can update allowed tools in Settings → Providers after installing.`
            : ""
        }
        confirmLabel="Install Anyway"
        onConfirm={handleConfirmInstall}
        onCancel={() => setToolConflictWarning(null)}
      />

      {/* Sign-in modal triggered from the persistent banner */}
      <RegistryAuthModal
        isOpen={showAuthFromEmpty}
        setIsOpen={setShowAuthFromEmpty}
        onAuthenticated={async () => {
          setShowAuthFromEmpty(false);
          setRegistryAuthed(true);
          // Force-refresh the cached registry index so the now-
          // authenticated user immediately sees their private packages
          // (the previous anon-cache fetch otherwise lingers for 5 min).
          try {
            await window.mainApi?.registry?.fetchIndex?.(true);
          } catch {
            /* best effort */
          }
          retry();
        }}
        onCancel={() => setShowAuthFromEmpty(false)}
        message="Sign in to see your private widgets and ones granted to you."
      />
    </div>
  );
};

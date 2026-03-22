import React, { useState, useEffect, useContext, useCallback } from "react";
import {
  Modal,
  Button,
  ThemeContext,
  FontAwesomeIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { RegistryAuthModal } from "../Components/Registry/RegistryAuthModal";
import { InstallProgressModal } from "../Components/Settings/details/InstallProgressModal";
import {
  getWidgetSearchQuery,
  packageToFlatWidget,
} from "../utils/registryUtils";

/**
 * MissingWidgetsModal — batch lookup and install for multiple missing widgets.
 *
 * Props:
 *   missingComponents – string[] of unresolvable component keys
 *   isOpen            – whether modal is visible
 *   setIsOpen         – close handler
 *   onInstallComplete – called after all installs finish
 */
export const MissingWidgetsModal = ({
  missingComponents = [],
  isOpen,
  setIsOpen,
  onInstallComplete,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [lookupResults, setLookupResults] = useState([]);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressWidgets, setProgressWidgets] = useState([]);
  const [progressComplete, setProgressComplete] = useState(false);

  // Batch lookup when modal opens
  useEffect(() => {
    if (!isOpen || missingComponents.length === 0) return;

    let cancelled = false;
    setIsLookingUp(true);
    setLookupResults([]);

    const lookup = async () => {
      const results = [];
      const seen = new Set();

      for (const componentKey of missingComponents) {
        const { packageName, widgetName } = getWidgetSearchQuery(componentKey);

        try {
          let pkg = null;

          // Scoped ID — exact package lookup
          if (packageName) {
            pkg = await window.mainApi.registry.getPackage(packageName);
          }

          // Fallback: search by widget name
          if (!pkg) {
            const result = await window.mainApi.registry.search(widgetName);
            pkg = (result.packages || []).find((p) =>
              (p.widgets || []).some((w) => w.name === widgetName),
            );
          }

          if (pkg && !seen.has(pkg.name)) {
            seen.add(pkg.name);
            results.push({
              componentKey,
              found: true,
              pkg,
              widget: packageToFlatWidget(pkg),
            });
          } else if (!pkg) {
            results.push({
              componentKey,
              found: false,
              pkg: null,
              widget: null,
            });
          }
        } catch {
          results.push({
            componentKey,
            found: false,
            pkg: null,
            widget: null,
          });
        }
      }

      if (!cancelled) {
        setLookupResults(results);
        setIsLookingUp(false);
      }
    };

    lookup();
    return () => {
      cancelled = true;
    };
  }, [isOpen, missingComponents]);

  const foundPackages = lookupResults.filter((r) => r.found);
  const notFoundItems = lookupResults.filter((r) => !r.found);

  const handleInstallAll = useCallback(async () => {
    if (foundPackages.length === 0) return;

    // Check auth first
    try {
      const status = await window.mainApi?.registryAuth?.getStatus();
      if (!status?.authenticated) {
        setNeedsAuth(true);
        return;
      }
    } catch {
      // Proceed anyway
    }

    // Build progress items
    const items = foundPackages.map((r) => ({
      packageName: r.pkg.name,
      displayName: r.pkg.displayName || r.pkg.name,
      status: "downloading",
    }));

    setProgressWidgets(items);
    setProgressComplete(false);
    setShowProgressModal(true);

    // Install sequentially
    for (let i = 0; i < foundPackages.length; i++) {
      const { widget } = foundPackages[i];
      try {
        const { packageName, packageScope, downloadUrl, packageVersion } =
          widget;
        const scopedId = packageScope
          ? `@${packageScope.replace(/^@/, "")}/${packageName}`
          : packageName;
        const resolvedUrl = (downloadUrl || "")
          .replace(/\{version\}/g, packageVersion)
          .replace(/\{name\}/g, packageName);

        await window.mainApi.widgets.install(scopedId, resolvedUrl);

        setProgressWidgets((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: "installed" };
          return next;
        });
      } catch (err) {
        setProgressWidgets((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            status: "failed",
            error: err.message || "Install failed",
          };
          return next;
        });
      }
    }

    setProgressComplete(true);
  }, [foundPackages]);

  const handleProgressDone = useCallback(() => {
    setShowProgressModal(false);
    setProgressWidgets([]);
    setProgressComplete(false);
    setIsOpen(false);
    if (onInstallComplete) onInstallComplete();
  }, [setIsOpen, onInstallComplete]);

  const handleAuthSuccess = useCallback(() => {
    setNeedsAuth(false);
    handleInstallAll();
  }, [handleInstallAll]);

  return (
    <>
      <Modal
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        width="w-[500px]"
        height="auto"
      >
        <div
          className={`flex flex-col rounded-lg overflow-hidden ${panelStyles.backgroundColor || "bg-gray-900"} ${panelStyles.textColor || "text-gray-200"}`}
        >
          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-sm font-semibold">Missing Widgets</h3>
            <p className="text-xs opacity-50 mt-1">
              {missingComponents.length} widget
              {missingComponents.length !== 1 ? "s" : ""} could not be found.
              Some may be available in the registry.
            </p>
          </div>

          {/* Lookup results */}
          <div className="px-5 pb-3 space-y-1.5 max-h-64 overflow-y-auto">
            {isLookingUp && (
              <div className="flex items-center gap-2 py-4 justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                <span className="text-xs opacity-50">
                  Looking up packages...
                </span>
              </div>
            )}

            {!isLookingUp &&
              foundPackages.map((r) => (
                <div
                  key={r.pkg.name}
                  className={`flex items-center gap-2.5 p-2 rounded ${currentTheme["bg-primary-medium"] || "bg-white/5"}`}
                >
                  <FontAwesomeIcon
                    icon="circle-check"
                    className="h-4 w-4 text-green-400 flex-shrink-0"
                  />
                  <span className="text-sm flex-1 truncate">
                    {r.pkg.displayName || r.pkg.name}
                  </span>
                  <span className="text-[10px] opacity-40">Available</span>
                </div>
              ))}

            {!isLookingUp &&
              notFoundItems.map((r) => (
                <div
                  key={r.componentKey}
                  className={`flex items-center gap-2.5 p-2 rounded ${currentTheme["bg-primary-medium"] || "bg-white/5"}`}
                >
                  <FontAwesomeIcon
                    icon="circle-xmark"
                    className="h-4 w-4 text-red-400 flex-shrink-0"
                  />
                  <span className="text-sm flex-1 truncate opacity-50">
                    {r.componentKey}
                  </span>
                  <span className="text-[10px] opacity-40">Not found</span>
                </div>
              ))}
          </div>

          {/* Footer */}
          <div
            className={`flex items-center justify-between px-5 py-3 border-t ${currentTheme["border-primary-medium"] || "border-white/10"}`}
          >
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              Close
            </button>
            {foundPackages.length > 0 && (
              <Button
                title={`Install ${foundPackages.length} Package${foundPackages.length !== 1 ? "s" : ""}`}
                bgColor="bg-blue-600"
                hoverBackgroundColor="hover:bg-blue-700"
                textSize="text-sm"
                padding="py-1.5 px-4"
                onClick={handleInstallAll}
                disabled={isLookingUp}
              />
            )}
          </div>
        </div>
      </Modal>

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
          if (!open) setNeedsAuth(false);
        }}
        onAuthenticated={handleAuthSuccess}
        onCancel={() => setNeedsAuth(false)}
        message="Sign in to install missing widgets from the Dash Registry."
      />
    </>
  );
};

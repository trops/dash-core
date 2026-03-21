import React, { useState, useCallback } from "react";
import { Modal, FontAwesomeIcon, Button } from "@trops/dash-react";
import { RegistryPackageDetail } from "../Components/Settings/details/RegistryPackageDetail";

/**
 * Extract a search query from a widget component key.
 *
 * Scoped IDs look like "scope.packageName.WidgetName" — we can do an exact
 * package lookup with the middle segment.  Plain names are just the widget
 * class name, so we fall back to a search.
 */
function getWidgetSearchQuery(componentKey) {
  const parts = componentKey.split(".");
  if (parts.length >= 3) {
    return {
      packageName: parts[1],
      widgetName: parts[2],
      scope: parts[0],
    };
  }
  return { packageName: null, widgetName: componentKey, scope: null };
}

/**
 * Convert a raw registry package object into the flat widget shape
 * expected by RegistryPackageDetail.
 */
function packageToFlatWidget(pkg) {
  return {
    key: `${pkg.name}/0`,
    name: pkg.displayName || pkg.name,
    icon: pkg.icon || null,
    isRegistry: true,
    packageName: pkg.name,
    packageScope: pkg.scope || null,
    packageDisplayName: pkg.displayName || pkg.name,
    packageVersion: pkg.version,
    packageAuthor: pkg.author || "",
    packageDescription: pkg.description || "",
    packageTags: pkg.tags || [],
    packageCategory: pkg.category || "",
    downloadUrl: pkg.downloadUrl || "",
    repository: pkg.repository || "",
    publishedAt: pkg.publishedAt || "",
    packageWidgets: pkg.widgets || [],
    appOrigin: pkg.appOrigin || null,
    packageProviders: pkg.providers || [],
    missingApis: [],
  };
}

/**
 * WidgetNotFound — rendered in place of an unresolvable widget.
 *
 * Shows the existing "Widget Not Found" error display and adds a
 * "Find in Registry" button that does an exact registry lookup and
 * opens an install modal.
 */
export const WidgetNotFound = ({ component }) => {
  const [showModal, setShowModal] = useState(false);
  const [registryWidget, setRegistryWidget] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState(null);

  const lookupWidget = useCallback(async () => {
    setShowModal(true);
    setIsLoading(true);
    setNotFound(false);
    setRegistryWidget(null);
    setInstallError(null);

    const { packageName, widgetName } = getWidgetSearchQuery(component);

    try {
      let pkg = null;

      // Scoped ID — exact package lookup
      if (packageName) {
        pkg = await window.mainApi.registry.getPackage(packageName);
      }

      // Fallback: search by widget name, find package containing it
      if (!pkg) {
        const result = await window.mainApi.registry.search(widgetName);
        pkg = (result.packages || []).find((p) =>
          (p.widgets || []).some((w) => w.name === widgetName),
        );
      }

      if (pkg) {
        setRegistryWidget(packageToFlatWidget(pkg));
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    }

    setIsLoading(false);
  }, [component]);

  const handleInstall = useCallback(async () => {
    if (!registryWidget) return;

    setIsInstalling(true);
    setInstallError(null);

    try {
      const { packageName, packageScope, downloadUrl, packageVersion } =
        registryWidget;

      const scopedId = packageScope
        ? `@${packageScope.replace(/^@/, "")}/${packageName}`
        : packageName;

      const resolvedUrl = downloadUrl
        .replace(/\{version\}/g, packageVersion)
        .replace(/\{name\}/g, packageName);

      await window.mainApi.widgets.install(scopedId, resolvedUrl);
      setShowModal(false);
    } catch (err) {
      setInstallError(err.message || "Failed to install package");
    }

    setIsInstalling(false);
  }, [registryWidget]);

  return (
    <>
      <div className="flex flex-col h-full justify-center items-center w-full z-10 gap-2 p-4 text-center">
        <FontAwesomeIcon
          icon="triangle-exclamation"
          className="h-6 w-6 text-amber-500"
        />
        <div className="text-sm font-semibold text-gray-300">
          Widget Not Found
        </div>
        <div className="text-xs text-gray-500 font-mono">{component}</div>
        <div className="text-xs text-gray-600 mt-1">
          This widget may have been uninstalled or renamed.
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors mt-2"
          onClick={lookupWidget}
        >
          <FontAwesomeIcon icon="magnifying-glass" className="h-3 w-3" />
          Find in Registry
        </button>
      </div>

      {showModal && (
        <Modal
          title="Registry Package"
          width="w-1/3"
          height="h-auto"
          onClose={() => setShowModal(false)}
        >
          {isLoading && (
            <div className="flex items-center justify-center p-12">
              <FontAwesomeIcon
                icon="spinner"
                className="h-5 w-5 text-gray-400 animate-spin"
              />
            </div>
          )}

          {!isLoading && registryWidget && (
            <RegistryPackageDetail
              widget={registryWidget}
              onInstall={handleInstall}
              isInstalling={isInstalling}
              installError={installError}
            />
          )}

          {!isLoading && notFound && (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              <FontAwesomeIcon
                icon="triangle-exclamation"
                className="h-6 w-6 text-amber-500"
              />
              <div className="text-sm text-gray-400">
                This widget is not available in the registry.
              </div>
              <Button
                title="Close"
                bgColor="bg-gray-600"
                hoverBackgroundColor="hover:bg-gray-700"
                textSize="text-sm"
                padding="py-1.5 px-4"
                onClick={() => setShowModal(false)}
              />
            </div>
          )}
        </Modal>
      )}
    </>
  );
};

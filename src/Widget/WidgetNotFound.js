import React, { useState, useCallback } from "react";
import { Modal, FontAwesomeIcon, Button } from "@trops/dash-react";
import { RegistryPackageDetail } from "../Components/Settings/details/RegistryPackageDetail";
import { RegistryAuthModal } from "../Components/Registry/RegistryAuthModal";
import {
  getWidgetSearchQuery,
  packageToFlatWidget,
} from "../utils/registryUtils";

/**
 * WidgetNotFound — rendered in place of an unresolvable widget.
 *
 * Shows the existing "Widget Not Found" error display and adds a
 * "Find in Registry" button that does an exact registry lookup and
 * opens an install modal.  When install requires auth, shows an inline
 * RegistryAuthPrompt and auto-retries after successful sign-in.
 */
export const WidgetNotFound = ({ component }) => {
  const [showModal, setShowModal] = useState(false);
  const [registryWidget, setRegistryWidget] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const lookupWidget = useCallback(async () => {
    setShowModal(true);
    setIsLoading(true);
    setNotFound(false);
    setRegistryWidget(null);
    setInstallError(null);
    setNeedsAuth(false);

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
    setNeedsAuth(false);

    try {
      // Check auth before attempting install — direct API call avoids
      // instantiating the full useRegistryAuth hook in this component.
      try {
        const status = await window.mainApi?.registryAuth?.getStatus();
        if (!status?.authenticated) {
          setNeedsAuth(true);
          setIsInstalling(false);
          return;
        }
      } catch {
        // If auth check fails, proceed anyway — install will fail with
        // Unauthorized which is caught below
      }

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
      const msg = err.message || "Failed to install package";
      if (msg.toLowerCase().includes("unauthorized")) {
        setNeedsAuth(true);
      } else {
        setInstallError(msg);
      }
    }

    setIsInstalling(false);
  }, [registryWidget]);

  const handleAuthSuccess = useCallback(() => {
    setNeedsAuth(false);
    handleInstall();
  }, [handleInstall]);

  const handleClose = useCallback(() => {
    setShowModal(false);
  }, []);

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

      <Modal
        isOpen={showModal}
        setIsOpen={setShowModal}
        width="w-1/3"
        height="auto"
      >
        <div className="relative max-h-[80vh] flex flex-col">
          {/* Close button — always visible */}
          <button
            type="button"
            className="absolute top-3 right-3 z-10 text-gray-500 hover:text-gray-300 transition-colors"
            onClick={handleClose}
          >
            <FontAwesomeIcon icon="xmark" className="h-4 w-4" />
          </button>

          {isLoading && (
            <div className="flex items-center justify-center p-12">
              <FontAwesomeIcon
                icon="spinner"
                className="h-5 w-5 text-gray-400 animate-spin"
              />
            </div>
          )}

          {!isLoading && registryWidget && (
            <div className="overflow-y-auto flex-1 min-h-0">
              <RegistryPackageDetail
                widget={registryWidget}
                onInstall={handleInstall}
                isInstalling={isInstalling}
                installError={installError}
              />
            </div>
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
                onClick={handleClose}
              />
            </div>
          )}
        </div>
      </Modal>

      <RegistryAuthModal
        isOpen={needsAuth && !!registryWidget}
        setIsOpen={(open) => {
          if (!open) setNeedsAuth(false);
        }}
        onAuthenticated={handleAuthSuccess}
        onCancel={() => setNeedsAuth(false)}
        message="Sign in to install this widget from the Dash Registry."
      />
    </>
  );
};

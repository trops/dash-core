import React, { useState, useEffect, useCallback, useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  SearchInput,
  Sidebar,
  Button,
  Paragraph,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { RegistryDashboardDetail } from "./RegistryDashboardDetail";
import { RegistryAuthModal } from "../../Registry/RegistryAuthModal";
import { RegistrySignInBanner } from "../../Registry/RegistrySignInBanner";

/**
 * DiscoverDashboardsDetail — registry browser for dashboard packages.
 *
 * Mirrors DiscoverWidgetsDetail structure: back button, search, scrollable
 * package list, and inline detail when a package is selected.
 */
export const DiscoverDashboardsDetail = ({
  onBack,
  appId,
  onInstallComplete,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [packages, setPackages] = useState([]);
  // Start in the loading state so the empty UI doesn't flash while the
  // initial debounce is pending — otherwise the sign-in nudge appears
  // briefly then disappears as soon as the registry returns results.
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPackageName, setSelectedPackageName] = useState(null);

  // Auth state — when the empty state shows up to a non-signed-in user,
  // they may not realize private packages they own are filtered out.
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
  }, [showAuthFromEmpty]);

  const search = useCallback(async (query) => {
    if (!window.mainApi?.registry?.searchDashboards) {
      setPackages([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.mainApi.registry.searchDashboards(
        query || "",
        {},
      );
      setPackages(result?.packages || []);
    } catch (err) {
      console.error("[DiscoverDashboards] Search error:", err);
      setError(err.message || "Failed to search dashboard registry");
      setPackages([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounce search on query changes
  useEffect(() => {
    const timer = setTimeout(() => {
      search(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const retry = () => search(searchQuery);

  const selectedPackage = selectedPackageName
    ? packages.find((p) => p.name === selectedPackageName)
    : null;

  // If a package is selected, show its detail inline
  if (selectedPackage) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
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
        <RegistryDashboardDetail
          dashboardPackage={selectedPackage}
          appId={appId}
          onInstallComplete={onInstallComplete}
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
            Loading dashboards...
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
            ? "No dashboards match your search."
            : "No dashboard packages available."}
        </Paragraph>
      </div>
    );
  } else {
    listBody = (
      <div className="space-y-1">
        {packages.map((pkg) => {
          const widgetCount = (pkg.widgets || []).length;
          return (
            <Sidebar.Item
              key={pkg.name}
              icon={
                <FontAwesomeIcon
                  icon={pkg.icon || "clone"}
                  className="h-3.5 w-3.5"
                />
              }
              onClick={() => setSelectedPackageName(pkg.name)}
              badge={widgetCount > 0 ? `${widgetCount}` : undefined}
            >
              {pkg.displayName || pkg.name}
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
          placeholder="Search dashboards..."
          inputClassName="py-1.5 text-xs"
        />
      </div>

      {/* Sign-in nudge — persistent above the list while unauthenticated */}
      <RegistrySignInBanner
        visible={registryAuthed === false}
        onSignIn={() => setShowAuthFromEmpty(true)}
        noun="dashboard"
      />

      {/* Package list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2">{listBody}</div>

      {/* Summary footer */}
      {!isLoading && !error && packages.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 text-[10px] opacity-40 border-t border-white/10">
          {packages.length} dashboard
          {packages.length !== 1 ? "s" : ""}
        </div>
      )}

      <RegistryAuthModal
        isOpen={showAuthFromEmpty}
        setIsOpen={setShowAuthFromEmpty}
        onAuthenticated={async () => {
          setShowAuthFromEmpty(false);
          setRegistryAuthed(true);
          // Force-refresh the cached registry index so the now-
          // authenticated user immediately sees their private packages.
          try {
            await window.mainApi?.registry?.fetchIndex?.(true);
          } catch {
            /* best effort */
          }
          search(searchQuery);
        }}
        onCancel={() => setShowAuthFromEmpty(false)}
        message="Sign in to see your private dashboards and install ones you've published."
      />
    </div>
  );
};

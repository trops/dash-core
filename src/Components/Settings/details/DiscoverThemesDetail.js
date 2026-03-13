import React, { useState, useEffect, useCallback, useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  SearchInput,
  Sidebar,
  Paragraph,
  Button,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { RegistryThemeDetail } from "./RegistryThemeDetail";

import { toDisplayColor } from "../../../utils/colorUtils";
import { ThemeColorDots } from "../../Theme/ThemeColorDots";

/**
 * DiscoverThemesDetail — registry browser for theme packages.
 *
 * Mirrors DiscoverDashboardsDetail structure: back button, search, scrollable
 * package list with color swatches, and inline detail when a package is selected.
 */
export const DiscoverThemesDetail = ({ onBack, appId, onInstallComplete }) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [packages, setPackages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPackageName, setSelectedPackageName] = useState(null);

  const search = useCallback(async (query) => {
    if (!window.mainApi?.registry?.searchThemes) {
      setPackages([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.mainApi.registry.searchThemes(
        query || "",
        {},
      );
      setPackages(result?.packages || []);
    } catch (err) {
      console.error("[DiscoverThemes] Search error:", err);
      setError(err.message || "Failed to search theme registry");
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
        <RegistryThemeDetail
          themePackage={selectedPackage}
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
            Loading themes...
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
            ? "No themes match your search."
            : "No theme packages available."}
        </Paragraph>
      </div>
    );
  } else {
    listBody = (
      <div className="space-y-1">
        {packages.map((pkg) => (
          <Sidebar.Item
            key={pkg.name}
            icon={<FontAwesomeIcon icon="palette" className="h-3.5 w-3.5" />}
            badge={<ThemeColorDots colors={pkg.colors} theme={pkg} />}
            onClick={() => setSelectedPackageName(pkg.name)}
          >
            {pkg.displayName || pkg.name}
          </Sidebar.Item>
        ))}
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
          placeholder="Search themes..."
          inputClassName="py-1.5 text-xs"
        />
      </div>

      {/* Package list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2">{listBody}</div>

      {/* Summary footer */}
      {!isLoading && !error && packages.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 text-[10px] opacity-40 border-t border-white/10">
          {packages.length} theme
          {packages.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
};

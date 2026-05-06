/**
 * PrivacySecurityList
 *
 * Left column of the redesigned Privacy & Security section. Mirrors
 * the DashboardsSection list style (search + Tabs3 toggle + grouped
 * Sidebar items with badge counts).
 *
 * Search matches against packageId AND component names within each
 * package, so typing "search" finds the package containing
 * GDriveFileSearch.
 */
import React, { useContext } from "react";
import {
  SearchInput,
  Sidebar,
  Tabs3,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  FontAwesomeIcon,
} from "@trops/dash-react";

function _matchesQuery(group, query) {
  if (!query) return true;
  const lower = query.toLowerCase();
  if (group.displayName.toLowerCase().includes(lower)) return true;
  // Match against component names within the package — typing
  // "search" surfaces the package containing GDriveFileSearch.
  return group.widgets.some((w) =>
    (w.widgetId || "").toLowerCase().includes(lower),
  );
}

export const PrivacySecurityList = ({
  packageGroups,
  selectedPackageKey,
  onSelectPackage,
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const headerStyles = getStylesForItem(
    themeObjects.PANEL_HEADER,
    currentTheme,
    { grow: false },
  );

  const filtered = packageGroups.filter((g) => _matchesQuery(g, searchQuery));
  const withGrants = filtered.filter((g) => g.hasAnyGrant);
  const withoutGrants = filtered.filter((g) => !g.hasAnyGrant);

  // packageId can be null (Ungrouped). Use displayName as a stable
  // selection key so null packageIds still differentiate.
  const keyFor = (group) =>
    group.packageId == null ? "__ungrouped__" : group.packageId;

  function renderPackageItem(group) {
    const key = keyFor(group);
    const isSelected = selectedPackageKey === key;
    return (
      <Sidebar.Item
        key={key}
        icon={
          <FontAwesomeIcon
            icon={group.hasAnyGrant ? "shield-halved" : "shield"}
            className="h-3.5 w-3.5"
          />
        }
        active={isSelected}
        onClick={() => onSelectPackage(key)}
        badge={String(group.grantCount)}
        className={isSelected ? "bg-white/10 opacity-100" : ""}
      >
        {group.displayName}
      </Sidebar.Item>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className={`flex-shrink-0 flex flex-col gap-2 px-3 py-2 ${
          headerStyles.backgroundColor || ""
        }`}
      >
        <SearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search packages..."
          inputClassName="py-1.5 text-xs"
        />
        <Tabs3
          value={viewMode}
          onValueChange={onViewModeChange}
          backgroundColor="bg-transparent"
          spacing="p-0"
        >
          <Tabs3.List className="w-full flex" spacing="p-0.5">
            <Tabs3.Trigger value="grouped" className="flex-1">
              Grouped
            </Tabs3.Trigger>
            <Tabs3.Trigger value="alphabetical" className="flex-1">
              A-Z
            </Tabs3.Trigger>
          </Tabs3.List>
        </Tabs3>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <Sidebar.Content>
          {viewMode === "grouped" ? (
            <>
              {withGrants.length > 0 && (
                <Sidebar.Group label="Has grants">
                  {withGrants.map(renderPackageItem)}
                </Sidebar.Group>
              )}
              {withoutGrants.length > 0 && (
                <Sidebar.Group label="No grants">
                  {withoutGrants.map(renderPackageItem)}
                </Sidebar.Group>
              )}
            </>
          ) : (
            filtered.map(renderPackageItem)
          )}
          {filtered.length === 0 && (
            <span className="text-sm opacity-40 py-8 text-center block">
              {searchQuery
                ? "No packages match your search"
                : "No widgets installed"}
            </span>
          )}
        </Sidebar.Content>
      </div>
    </div>
  );
};

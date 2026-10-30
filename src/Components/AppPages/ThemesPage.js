import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Button,
  Button3,
  ConfirmationModal,
  FontAwesomeIcon,
  SearchInput,
  SectionLabel,
  SegmentedControl,
  ThemeContext,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { ThemeColorDots } from "../Theme/ThemeColorDots";
import { ThemeManagerModal } from "../Theme/ThemeManagerModal";
import { DiscoverThemesDetail } from "../Settings/details/DiscoverThemesDetail";
import { PublishThemeModal } from "../Settings/details/PublishThemeModal";
import { ColorSwatchGrid } from "../Theme/ColorSwatchGrid";
import { ThemePreview } from "./ThemePreview";
import { themeOrigin } from "../../utils/themeStanding";
import {
  canPublishTheme,
  duplicateTheme,
  filterThemes,
  themeRows,
} from "./themeSummary";
import { ManageLayout, OverflowMenu } from "./ManageLayout";

/**
 * Change with AI (theme change round, frame 48): a Dash Lead conversation
 * "Changing: <theme>" — a theme downloaded from the registry says whose,
 * since the change becomes a remix that credits them.
 */
function changeWithAi(row, rawTheme) {
  const origin = themeOrigin(rawTheme || row.theme);
  window.dispatchEvent(
    new CustomEvent("dash:open-workspace", {
      detail: {
        key: "role:dashlead",
        making: {
          kind: "themechange",
          theme: row.name,
          by: origin ? origin.author || origin.package : null,
        },
      },
    }),
  );
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const CHIPS = [
  { value: "all", label: "All" },
  { value: "inUse", label: "In use" },
  { value: "notUsed", label: "Not used" },
];
const VARIANTS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

/** "App theme" / "Used by 2 dashboards" / "Not in use". */
const usageText = (row) =>
  row.isApp
    ? "App theme"
    : row.usedBy.length
      ? `Used by ${plural(row.usedBy.length, "dashboard")}`
      : "Not in use";

/** One theme's details (the right-hand panel). */
const ThemeDetailPanel = ({
  row,
  rawTheme,
  appVariant,
  workspaces,
  appId,
  onUseAsApp,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenWorkspace,
}) => {
  const { muted, strong } = useConfigTokens();
  const [variant, setVariant] = useState(appVariant || "dark");
  const [publishOpen, setPublishOpen] = useState(false);
  const theme = row.theme || {};
  const canPublish = canPublishTheme(theme, rawTheme);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="flex flex-row items-center gap-2 min-w-0">
            <h3 className={`text-lg font-semibold truncate ${strong}`}>
              {row.name}
            </h3>
            <ThemeColorDots theme={theme} size="h-3 w-3" />
          </span>
          <span className={`text-sm ${muted}`}>
            {row.isApp ? "Current app theme" : usageText(row)}
          </span>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          {row.isApp ? null : (
            <Button
              title="Use as app theme"
              size="sm"
              onClick={() => onUseAsApp(row.key)}
            />
          )}
          <Button3
            title="Change with AI"
            size="sm"
            onClick={() => changeWithAi(row, rawTheme)}
          />
          <Button3
            title="Edit theme"
            size="sm"
            onClick={() => onEdit(row.key)}
          />
          <OverflowMenu
            items={[
              {
                label: "Duplicate",
                icon: "clone",
                onClick: () => onDuplicate(row.key),
              },
              canPublish
                ? {
                    label: "Publish…",
                    icon: "cloud-arrow-up",
                    onClick: () => setPublishOpen(true),
                  }
                : null,
              row.isApp
                ? null
                : {
                    label: "Delete",
                    icon: "trash-can",
                    onClick: () => onDelete(row),
                  },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-row items-center justify-between gap-3">
          <SectionLabel text="Preview" />
          <SegmentedControl
            ariaLabel="Preview variant"
            options={VARIANTS}
            value={variant}
            onChange={setVariant}
          />
        </div>
        <ThemePreview theme={theme} variant={variant} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Palette" />
          <ColorSwatchGrid displayTheme={theme[variant] || {}} />
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Used by" />
          {row.usedBy.length ? (
            <div className="flex flex-col gap-1.5">
              {row.usedBy.map((u) => {
                const ws = workspaces.find((w) => w.id === u.workspaceId);
                return (
                  <div
                    key={u.workspaceId}
                    className="flex flex-row items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{u.workspaceName}</span>
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
          ) : (
            <span className={`text-sm ${muted}`}>
              {row.isApp
                ? "Every dashboard without its own theme."
                : "No dashboards use it."}
            </span>
          )}
        </div>
      </div>

      {canPublish ? (
        <PublishThemeModal
          isOpen={publishOpen}
          setIsOpen={setPublishOpen}
          appId={appId}
          themeKey={row.key}
          themeName={row.name}
        />
      ) : null}
    </div>
  );
};

/**
 * ThemesPage — every theme as list + detail (app-navigation PRD NAV-009):
 * the app theme first, where each theme is used, search and In use / Not
 * used chips; the detail previews the
 * theme in its own colours (Dark / Light without changing the app), shows
 * its palette and dashboards, with Use as app theme / Edit theme / Duplicate
 * / Publish / Delete. New Theme opens the creation wizard.
 */
export const ThemesPage = ({
  workspaces = [],
  dashApi = null,
  credentials = null,
  onOpenWorkspace = null,
  onOpenThemeEditor = null,
  createRequested = false,
  onCreateAcknowledged = null,
}) => {
  const { muted, strong, selectedBg, selectedBorder } = useConfigTokens();
  const {
    themes,
    rawThemes,
    themeKey: appThemeKey,
    themeVariant,
    changeCurrentTheme,
    changeThemesForApplication,
  } = useContext(ThemeContext) || {};
  const appId = credentials?.appId;

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");
  const [selectedKey, setSelectedKey] = useState(null);
  // null | "marketplace"
  const [mode, setMode] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [status, setStatus] = useState(null);

  // The header's New Theme opens the creation wizard (all five ways to make
  // a theme live there).
  const prevCreate = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreate.current) {
      setWizardOpen(true);
      setMode(null);
    }
    prevCreate.current = createRequested;
    if (createRequested && onCreateAcknowledged) onCreateAcknowledged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  const rows = themeRows(themes, { appThemeKey, workspaces });
  const shown = filterThemes(rows, { query, chip });
  const selected = shown.find((r) => r.key === selectedKey) || shown[0] || null;

  const flash = (text) => {
    setStatus(text);
    setTimeout(() => setStatus(null), 3000);
  };

  const applyThemes = (message) => {
    if (message && message.themes && changeThemesForApplication) {
      changeThemesForApplication(message.themes);
    }
  };

  const duplicate = (key) => {
    if (!dashApi || !appId) return;
    const raw = (rawThemes && rawThemes[key]) || {};
    const copy = duplicateTheme(raw, key);
    dashApi.saveTheme(
      appId,
      copy.key,
      copy.theme,
      (e, message) => {
        applyThemes(message);
        setMode(null);
        setSelectedKey(copy.key);
        flash(`Saved "${copy.theme.name}".`);
      },
      (e, err) => {
        console.error("Error duplicating theme:", err);
        flash("Couldn't duplicate the theme.");
      },
    );
  };

  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target || !dashApi || !appId || target.isApp) return;
    dashApi.deleteTheme(
      appId,
      target.key,
      (e, message) => {
        applyThemes(message);
        if (selectedKey === target.key) setSelectedKey(null);
      },
      (e, err) => {
        console.error("Error deleting theme:", err);
        flash("Couldn't delete the theme.");
      },
    );
  };

  const deleteMessage = (row) => {
    if (!row) return "";
    if (!row.usedBy.length) return "This can't be undone.";
    const names = row.usedBy.map((u) => u.workspaceName).join(", ");
    return `${names} ${
      row.usedBy.length === 1 ? "uses" : "use"
    } it and will switch to the app theme. This can't be undone.`;
  };

  let detail;
  if (mode === "marketplace") {
    detail = (
      <DiscoverThemesDetail
        onBack={() => setMode(null)}
        appId={appId}
        onInstallComplete={() => {
          if (dashApi && appId) {
            dashApi.listThemes(appId, (e, message) => applyThemes(message));
          }
        }}
      />
    );
  } else if (selected) {
    detail = (
      <ThemeDetailPanel
        key={selected.key}
        row={selected}
        rawTheme={rawThemes ? rawThemes[selected.key] : null}
        appVariant={themeVariant}
        workspaces={workspaces}
        appId={appId}
        onUseAsApp={(key) => changeCurrentTheme && changeCurrentTheme(key)}
        onEdit={(key) => onOpenThemeEditor && onOpenThemeEditor(key)}
        onDuplicate={duplicate}
        onDelete={setDeleteTarget}
        onOpenWorkspace={onOpenWorkspace}
      />
    );
  } else {
    detail = (
      <span className={`text-sm ${muted}`}>
        {rows.length ? "No themes match these filters." : "No themes yet."}
      </span>
    );
  }

  return (
    <ManageLayout
      testId="themes-page"
      listLabel="Themes"
      detailTestId="theme-detail"
      toolbar={
        <>
          <div className="w-72">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search themes…"
            />
          </div>
          <SegmentedControl
            ariaLabel="Show"
            options={CHIPS}
            value={chip}
            onChange={setChip}
          />
          <span className="flex-1" />
          {status ? <span className={`text-sm ${muted}`}>{status}</span> : null}
          {/* No app-wide Light / Dark switch here: the app's mode lives in
              the account menu; the detail's Dark / Light only previews. */}
          <Button3
            title="Browse marketplace"
            size="sm"
            onClick={() => setMode("marketplace")}
          />
        </>
      }
      list={
        <div className="flex flex-col gap-0.5">
          {shown.map((row) => {
            const active = !mode && selected && row.key === selected.key;
            return (
              <button
                key={row.key}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => {
                  setMode(null);
                  setSelectedKey(row.key);
                }}
                className={`w-full text-left rounded-lg px-2 py-2 border flex flex-row items-center gap-3 ${
                  active
                    ? `${selectedBg} ${selectedBorder}`
                    : "border-transparent"
                }`}
              >
                <ThemeColorDots theme={row.theme} size="h-3 w-3" />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span
                    data-name
                    className={`text-sm font-medium truncate ${strong}`}
                  >
                    {row.name}
                  </span>
                  <span className={`text-xs truncate ${muted}`}>
                    {usageText(row)}
                  </span>
                </span>
                {row.isApp ? (
                  <FontAwesomeIcon icon="check" className="text-green-400" />
                ) : null}
              </button>
            );
          })}
          {!shown.length ? (
            <span className={`text-sm px-2 ${muted}`}>No themes match.</span>
          ) : null}
        </div>
      }
      detail={detail}
    >
      <ConfirmationModal
        isOpen={!!deleteTarget}
        setIsOpen={() => setDeleteTarget(null)}
        title={`Delete "${deleteTarget ? deleteTarget.name : ""}"?`}
        message={deleteMessage(deleteTarget)}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ThemeManagerModal
        open={wizardOpen}
        setIsOpen={(next) => {
          // Called with a value or a toggle function depending on the site.
          if (typeof next === "function") setWizardOpen((prev) => next(prev));
          else setWizardOpen(next === true);
        }}
        startInCreate={true}
      />
    </ManageLayout>
  );
};

export default ThemesPage;

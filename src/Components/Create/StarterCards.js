import React, { useEffect, useState } from "react";
import { Button3, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { starterCard, starterCategories, thumbnailGrid } from "./starters";

/**
 * StarterCards — starters under Create's prompt (create-entry PRD CRE-002
 * AC1/AC2, phase 5b): category tabs, and per starter a drawn thumbnail of
 * its layout, its name and line, what it makes and what it needs. Picking
 * one hands its package config to `onPick` — the plan opens; nothing is
 * installed or built here.
 */

const titleCase = (s) =>
  String(s || "").replace(
    /(^|[-_\s])(\w)/g,
    (_m, sep, c) => (sep ? " " : "") + c.toUpperCase(),
  );

/** The layout drawn small: one box per grid cell, labelled. */
export const StarterThumbnail = ({ config }) => {
  const { muted, hairline } = useConfigTokens();
  if (!config) {
    return (
      <div
        className={`w-full rounded border ${hairline}`}
        style={{ height: "3.5rem" }}
        aria-hidden="true"
      />
    );
  }
  const { rows, cols, cells } = thumbnailGrid(config);
  return (
    <div
      className="w-full gap-1"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        height: "3.5rem",
      }}
      aria-hidden="true"
      data-testid="starter-thumbnail"
    >
      {cells.map((c) => (
        <div
          key={c.key}
          className={`rounded border px-1 overflow-hidden text-xs truncate ${hairline} ${muted}`}
          style={{ gridRow: c.row, gridColumn: c.col }}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
};

export const StarterCards = ({ starters = [], onPick }) => {
  const { muted, strong } = useConfigTokens();
  const [tab, setTab] = useState("all");
  // packageName → config (for the thumbnail and the plan), or an error.
  const [configs, setConfigs] = useState({});

  useEffect(() => {
    let alive = true;
    const api = window.mainApi && window.mainApi.dashboardConfig;
    if (!api || !api.getPackageConfig) return undefined;
    for (const pkg of starters) {
      if (configs[pkg.name]) continue;
      Promise.resolve(api.getPackageConfig(pkg.name))
        .then((res) => {
          if (!alive) return;
          setConfigs((c) => ({
            ...c,
            [pkg.name]:
              res && res.success
                ? { config: res.config }
                : { error: (res && res.error) || "It couldn't be read." },
          }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starters]);

  if (!starters.length) return null;
  const categories = starterCategories(starters);
  const shown = starters.filter(
    (p) => tab === "all" || (p.category || "general") === tab,
  );

  return (
    <div className="flex flex-col gap-2" data-testid="create-starters">
      <SectionLabel>Start from a starter</SectionLabel>
      {categories.length > 1 ? (
        <div className="flex flex-row flex-wrap gap-1">
          {["all", ...categories].map((c) => (
            <Button3
              key={c}
              size="sm"
              title={c === "all" ? "All" : titleCase(c)}
              onClick={() => setTab(c)}
              disabled={tab === c}
            />
          ))}
        </div>
      ) : null}
      {/* Cards side by side, as many as fit (inline: the app's prebuilt CSS
          has no responsive grid classes). */}
      <div
        className="gap-2"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(13rem, 1fr))",
          alignItems: "start",
        }}
      >
        {shown.map((pkg) => {
          const card = starterCard(pkg);
          const loaded = configs[pkg.name];
          return (
            <Button3
              key={card.key}
              onClick={() =>
                loaded &&
                loaded.config &&
                onPick &&
                onPick(card, pkg, loaded.config)
              }
              disabled={!loaded || !loaded.config}
            >
              <span
                className="flex flex-col items-start gap-1 text-left w-full"
                // Buttons don't wrap their text; a card must.
                style={{
                  whiteSpace: "normal",
                  minWidth: 0,
                  overflow: "hidden",
                }}
                data-testid="starter-card"
                aria-label={`${card.name}: ${card.line}. Makes ${card.makes}. Needs ${card.needs}.`}
              >
                <StarterThumbnail config={loaded && loaded.config} />
                <span className={`text-sm font-semibold ${strong}`}>
                  {card.name}
                </span>
                {card.line ? (
                  <span className={`text-xs ${muted}`}>{card.line}</span>
                ) : null}
                <span className={`text-xs ${muted}`}>
                  Makes {card.makes} · needs {card.needs}
                </span>
                {loaded && loaded.error ? (
                  <span className="text-xs">{loaded.error}</span>
                ) : null}
              </span>
            </Button3>
          );
        })}
      </div>
    </div>
  );
};

export default StarterCards;

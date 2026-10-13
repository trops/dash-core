import React, { useEffect, useState } from "react";
import { Card2, SegmentedControl, SubHeading3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { starterCard, starterCategories, thumbnailGrid } from "./starters";

/**
 * StarterCards — starters under Create's prompt (create-entry PRD CRE-002
 * AC1/AC2, phase 5b): a category filter, and per starter a card (dash-react
 * Card2 — a button: Tab, then Enter or Space) with a preview of its layout,
 * its name and line, what it makes and what it needs. Picking one hands its
 * package config to `onPick` — the plan opens; nothing is installed or built
 * here. Laid out to the design guide's Screen layout rules (screen audit,
 * October 2026): each starter is a contained card; text is 15/14/12px.
 */

const titleCase = (s) =>
  String(s || "").replace(
    /(^|[-_\s])(\w)/g,
    (_m, sep, c) => (sep ? " " : "") + c.toUpperCase(),
  );

/**
 * The layout drawn small, in a recessed well: one shaded tile per grid cell
 * (shading only, no borders — it is a picture, not cards in a card), each
 * named at 12px (wrapping; the full name also on hover), so the picture
 * says what's on the dashboard and where.
 */
export const StarterThumbnail = ({ config }) => {
  const { muted } = useConfigTokens();
  const well = "w-full rounded-md p-1.5";
  const wellStyle = {
    height: "5rem",
    background: "var(--raised-2, rgba(0,0,0,0.18))",
  };
  if (!config) {
    return <div className={well} style={wellStyle} aria-hidden="true" />;
  }
  const { rows, cols, cells } = thumbnailGrid(config);
  return (
    <div className={well} style={wellStyle} aria-hidden="true">
      <div
        className="w-full h-full gap-1"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
        data-testid="starter-thumbnail"
      >
        {cells.map((c) => (
          <div
            key={c.key}
            title={c.label || undefined}
            className={`rounded p-1.5 text-xs leading-snug overflow-hidden ${muted}`}
            style={{
              gridRow: c.row,
              gridColumn: c.col,
              // One surface step above the well, in both modes.
              background:
                "color-mix(in srgb, var(--text, #888) 9%, var(--solid, transparent))",
              wordBreak: "break-word",
            }}
          >
            {c.label}
          </div>
        ))}
      </div>
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
    <section className="flex flex-col gap-3" data-testid="create-starters">
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <SubHeading3 title="Start from a starter" padding={false} />
        {categories.length > 1 ? (
          <SegmentedControl
            ariaLabel="Starter category"
            size="md"
            value={tab}
            onChange={setTab}
            options={["all", ...categories].map((c) => ({
              value: c,
              label: c === "all" ? "All" : titleCase(c),
            }))}
          />
        ) : null}
      </div>
      {/* Cards side by side, as many as fit, all the same height (inline:
          the app's prebuilt CSS has no responsive grid classes). */}
      <div
        className="gap-3"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))",
          alignItems: "stretch",
        }}
      >
        {shown.map((pkg) => {
          const card = starterCard(pkg);
          const loaded = configs[pkg.name];
          const ready = !!(loaded && loaded.config);
          return (
            <Card2
              key={card.key}
              testId="starter-card"
              padding="p-4"
              rounded="rounded-lg"
              shadow=""
              className="flex flex-col gap-2 h-full text-left"
              ariaLabel={`${card.name}: ${card.line}. Makes ${card.makes}. Needs ${card.needs}.`}
              disabled={!ready}
              onClick={() =>
                ready && onPick && onPick(card, pkg, loaded.config)
              }
            >
              <StarterThumbnail config={loaded && loaded.config} />
              <span className={`text-base font-semibold ${strong}`}>
                {card.name}
              </span>
              {card.line ? (
                <span className={`text-sm ${muted}`}>{card.line}</span>
              ) : null}
              {/* What it makes, then what it needs — each on its own line
                  so a long provider list never strands a word. */}
              <span className={`flex flex-col text-xs ${muted}`}>
                <span>Makes {card.makes}</span>
                <span>Needs {card.needs}</span>
              </span>
              {loaded && loaded.error ? (
                <span className={`text-sm ${strong}`}>{loaded.error}</span>
              ) : null}
            </Card2>
          );
        })}
      </div>
    </section>
  );
};

export default StarterCards;

import React from "react";
import { FontAwesomeIcon } from "@trops/dash-react";

/**
 * WizardThemePreview — static theme-against-layout preview tile.
 *
 * Renders an N×M grid mirroring the wizard's chosen layout template,
 * with each cell colored by rotating through the selected theme's
 * `primary` / `secondary` / `tertiary` color tokens (Tailwind family
 * names like "sky", "purple"). The classes used here
 * (`bg-${family}-500`) are all in the dash-electron Tailwind safelist
 * via the existing theme swatches in the Theme picker — same family,
 * same shade — so this doesn't add any new utility classes that could
 * silently fail to render.
 *
 * Static only: no LayoutBuilder mount, no widget rendering. The goal
 * is "what will my colors look like in this shape?", not "fully
 * interactive preview." Richer fidelity is deferred to P2.
 *
 * Lives in its own file (vs. inline in WizardCustomizeStep) so its
 * unit test can render it without the wizard's full Context/Layout
 * import chain. Pure presentation — safe to test in isolation.
 */

// Cell-count map keyed by templateKey. Mirrors the templates in
// LayoutManager/layoutTemplates.js but only carries what the preview
// needs (rows × cols). Unknown / missing keys fall back to 2×2 so the
// preview always has a sensible shape.
const PREVIEW_TEMPLATE_SHAPE = {
  single: { rows: 1, cols: 1 },
  "two-columns": { rows: 1, cols: 2 },
  "two-rows": { rows: 2, cols: 1 },
  "three-columns": { rows: 1, cols: 3 },
  "two-by-two": { rows: 2, cols: 2 },
  "two-by-three": { rows: 2, cols: 3 },
  "three-by-three": { rows: 3, cols: 3 },
};

export function WizardThemePreview({ theme, templateKey }) {
  if (!theme) return null;
  const shape = PREVIEW_TEMPLATE_SHAPE[templateKey] || { rows: 2, cols: 2 };
  const familyOrder = [theme.primary, theme.secondary, theme.tertiary].filter(
    (f) => typeof f === "string" && f.length > 0,
  );
  if (familyOrder.length === 0) return null;
  const totalCells = shape.rows * shape.cols;
  return (
    <div
      className="rounded-lg border border-gray-700/50 bg-gray-900/30 p-3 flex flex-col gap-2"
      data-testid="wizard-theme-preview"
    >
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <FontAwesomeIcon icon="eye" fixedWidth className="text-gray-500" />
        <span>Preview · {theme.name || ""}</span>
        {templateKey && (
          <span className="text-gray-600">
            ({shape.rows}×{shape.cols})
          </span>
        )}
      </div>
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))`,
          gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`,
          minHeight: "5rem",
        }}
        data-testid="wizard-theme-preview-grid"
      >
        {Array.from({ length: totalCells }).map((_, i) => {
          const family = familyOrder[i % familyOrder.length];
          return (
            <div
              key={i}
              className={`rounded bg-${family}-500/70 border border-${family}-400/40`}
              data-testid={`wizard-theme-preview-cell-${i}`}
              data-family={family}
            />
          );
        })}
      </div>
    </div>
  );
}

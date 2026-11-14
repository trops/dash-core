import React from "react";
import { paint } from "./themeSummary";

/**
 * ThemePreview — a small mock dashboard drawn in a theme's own colours
 * (app-navigation PRD NAV-009 AC2): header, sidebar, three widget cards, a
 * button and a tag. A theme with Aurora tokens (ThemeModel's cssVars) is
 * drawn as the app shows it — Aurora tinted at its Strength; an older one
 * inline from the variant's `cssValue`. Either way any theme previews
 * correctly — not just the active one.
 *
 * @param {object} theme    a ThemeModel theme (with .dark / .light)
 * @param {string} variant  "dark" | "light"
 * @param {boolean} compact half a column wide (a theme in a plan): no
 *   sidebar, two cards
 */
const CARDS = ["Inbox", "Pipeline", "Calendar"];

// Aurora's text colours per mode (dash-react designSystem.css): a theme
// tints surfaces and the accent, never text.
const AURORA_TEXT = {
  dark: { strong: "#f0f1f5", muted: "#a4a9b8" },
  light: { strong: "#1a1d23", muted: "#4f5562" },
};

/**
 * The theme as the app shows it: Aurora, tinted at the theme's Strength
 * (its cssVars carry the tokens), so the preview matches the real screens.
 */
const AuroraPreview = ({ theme, variant, v, compact }) => {
  const text = AURORA_TEXT[variant === "light" ? "light" : "dark"];
  const line = (width) => (
    <span
      className="block h-1.5 rounded-full"
      style={{ width, backgroundColor: text.muted, opacity: 0.45 }}
    />
  );
  return (
    <div
      data-testid="theme-preview"
      data-strength={v.strength || theme.strength || "balanced"}
      className={`flex flex-col ${compact ? "" : "h-64"} rounded-xl overflow-hidden border`}
      style={{
        ...v.cssVars,
        background: "var(--mesh), var(--bg)",
        borderColor: "var(--hairline-strong)",
        color: text.strong,
      }}
    >
      <div
        data-testid="preview-header"
        className="flex flex-row items-center justify-between px-4 py-2 flex-shrink-0 border-b"
        style={{ borderColor: "var(--hairline)" }}
      >
        <span className="text-sm font-semibold">
          {theme.name || "Dashboard"}
        </span>
        <span
          data-testid="preview-button"
          className="px-2 py-0.5 rounded text-xs font-semibold"
          style={{ background: "var(--accent-grad)", color: "#ffffff" }}
        >
          Button
        </span>
      </div>
      <div className="flex flex-row flex-1 min-h-0">
        {compact ? null : (
          <div className="flex flex-col gap-2 w-24 p-3 flex-shrink-0">
            {line("80%")}
            {line("60%")}
            {line("70%")}
          </div>
        )}
        <div
          className={`flex-1 grid ${compact ? "grid-cols-2 gap-2 p-2" : "grid-cols-3 gap-3 p-3"}`}
        >
          {(compact ? CARDS.slice(0, 2) : CARDS).map((title, i) => (
            <div
              key={title}
              data-testid="preview-card"
              className="flex flex-col gap-2 rounded-lg border p-3"
              style={{
                background: "var(--raised)",
                borderColor: "var(--hairline)",
              }}
            >
              <span
                className="block h-1 w-8 rounded-full"
                style={{ backgroundColor: "var(--accent)" }}
              />
              <span className="text-xs font-semibold">{title}</span>
              {line("90%")}
              {line("65%")}
              {i === 1 ? (
                <span
                  className="self-start px-1.5 py-0.5 rounded text-xs font-semibold"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--accent-2) 20%, transparent)",
                    color: "var(--accent-text)",
                  }}
                >
                  Tag
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const ThemePreview = ({ theme, variant = "dark", compact = false }) => {
  const v = theme && theme[variant];
  if (v && v.cssVars && v.cssVars["--bg"]) {
    return (
      <AuroraPreview theme={theme} variant={variant} v={v} compact={compact} />
    );
  }
  if (!v || !v.cssValue) {
    return (
      <div className="flex items-center justify-center h-48 rounded-lg border text-sm">
        No preview for this theme
      </div>
    );
  }
  const c = (token) => paint(v, token);
  const strong = c("text-neutral-light");
  const muted = c("text-neutral-medium");
  const hairline = c("border-neutral-medium");
  const line = (width, color) => (
    <span
      className="block h-1.5 rounded-full"
      style={{ width, backgroundColor: color, opacity: 0.6 }}
    />
  );

  return (
    <div
      data-testid="theme-preview"
      // Compact: as tall as its cards (the plan's two side by side).
      className={`flex flex-col ${compact ? "" : "h-64"} rounded-lg overflow-hidden border`}
      style={{
        backgroundColor: c("bg-neutral-very-dark"),
        borderColor: hairline,
      }}
    >
      <div
        data-testid="preview-header"
        className="flex flex-row items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ backgroundColor: c("bg-primary-dark"), color: strong }}
      >
        <span className="text-sm font-semibold">
          {theme.name || "Dashboard"}
        </span>
        <span
          data-testid="preview-button"
          className="px-2 py-0.5 rounded text-xs"
          style={{ backgroundColor: c("bg-primary-medium"), color: strong }}
        >
          Button
        </span>
      </div>
      <div className="flex flex-row flex-1 min-h-0">
        {compact ? null : (
          <div
            className="flex flex-col gap-2 w-24 p-3 flex-shrink-0"
            style={{ backgroundColor: c("bg-neutral-dark") }}
          >
            {line("80%", muted)}
            {line("60%", muted)}
            {line("70%", muted)}
          </div>
        )}
        <div
          className={`flex-1 grid ${compact ? "grid-cols-2 gap-2 p-2" : "grid-cols-3 gap-3 p-3"}`}
        >
          {(compact ? CARDS.slice(0, 2) : CARDS).map((title, i) => (
            <div
              key={title}
              data-testid="preview-card"
              className="flex flex-col gap-2 rounded-md border p-3"
              style={{
                backgroundColor: c("bg-neutral-dark"),
                borderColor: hairline,
              }}
            >
              <span
                className="block h-1 w-8 rounded-full"
                style={{ backgroundColor: c("bg-tertiary-medium") }}
              />
              <span className="text-xs font-semibold" style={{ color: strong }}>
                {title}
              </span>
              {line("90%", muted)}
              {line("65%", muted)}
              {i === 1 ? (
                <span
                  className="self-start px-1.5 py-0.5 rounded text-xs"
                  style={{
                    backgroundColor: c("bg-secondary-dark"),
                    color: c("text-secondary-light"),
                  }}
                >
                  Tag
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ThemePreview;

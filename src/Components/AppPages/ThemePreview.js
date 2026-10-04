import React from "react";
import { paint } from "./themeSummary";

/**
 * ThemePreview — a small mock dashboard drawn in a theme's own colours
 * (app-navigation PRD NAV-009 AC2): header, sidebar, three widget cards, a
 * button and a tag. Colours are inline from the variant's `cssValue`, so any
 * theme previews correctly — not just the active one.
 *
 * @param {object} theme    a ThemeModel theme (with .dark / .light)
 * @param {string} variant  "dark" | "light"
 */
const CARDS = ["Inbox", "Pipeline", "Calendar"];

export const ThemePreview = ({ theme, variant = "dark" }) => {
  const v = theme && theme[variant];
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
      className="flex flex-col h-64 rounded-lg overflow-hidden border"
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
        <div
          className="flex flex-col gap-2 w-24 p-3 flex-shrink-0"
          style={{ backgroundColor: c("bg-neutral-dark") }}
        >
          {line("80%", muted)}
          {line("60%", muted)}
          {line("70%", muted)}
        </div>
        <div className="flex-1 grid grid-cols-3 gap-3 p-3">
          {CARDS.map((title, i) => (
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

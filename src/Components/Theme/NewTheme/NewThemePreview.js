import React, { useContext, useMemo } from "react";
import {
  Button,
  Button2,
  Button3,
  Card,
  ProgressBar,
  Tag,
  Tag2,
  Tag3,
  ThemeContext,
  getDashTokens,
} from "@trops/dash-react";
import { ThemeModel } from "../../../Models/ThemeModel";
import { ThemePartsStyle } from "../ThemePartsStyle";

// Aurora's dark base (dash-react designSystem.css :root), so a Dark preview
// stays dark inside a light app; Light comes from [data-mode="light"].
export const DARK_BASE = {
  "--raised-2": "rgba(0, 0, 0, 0.25)",
  "--hairline-strong": "rgba(255, 255, 255, 0.14)",
  "--text": "#f0f1f5",
  "--text-2": "#a4a9b8",
  "--text-3": "#9095a6",
  "--green": "#52d59a",
  "--green-soft": "rgba(82, 213, 154, 0.15)",
  "--amber": "#e6b25a",
  "--amber-soft": "rgba(230, 178, 90, 0.15)",
  "--red": "#f47076",
  "--red-soft": "rgba(244, 112, 118, 0.15)",
  "--shadow": "0 6px 20px rgba(0, 0, 0, 0.28)",
  "--card-shadow": "0 10px 34px rgba(0, 0, 0, 0.32)",
};

const ROWS = [
  ["9:30", "Team standup", Tag, "Work"],
  ["12:00", "Lunch with Sam", Tag2, "Personal"],
  ["2:00", "Dentist", Tag3, "Health"],
];

/**
 * How dashboards look in a theme that isn't saved yet: real dash-react
 * components under the theme's own tokens (ThemeModel at its strength),
 * scoped to this box — the app doesn't change.
 */
export const NewThemePreview = ({ theme, variant = "dark" }) => {
  const parent = useContext(ThemeContext) || {};
  const v = useMemo(
    () => (theme ? ThemeModel(theme)[variant] : null),
    [theme, variant],
  );
  if (!v) return null;
  const t = getDashTokens(v);
  const style = {
    ...(variant === "dark" ? DARK_BASE : {}),
    ...(v.cssVars || {}),
    background: "var(--bg)",
  };
  return (
    <ThemeContext.Provider
      value={{ ...parent, currentTheme: v, theme: v, themeVariant: variant }}
    >
      <div
        data-mode={variant}
        data-testid="new-theme-preview"
        data-own-theme="new-theme-preview"
        className={`rounded-xl overflow-hidden border ${t.hairline}`}
        style={style}
      >
        <ThemePartsStyle variantModel={v} scope="new-theme-preview" />
        <div
          className={`flex flex-row items-center gap-2 px-4 py-2.5 border-b ${t.hairline}`}
        >
          <span className={`text-sm font-semibold flex-1 ${t.text}`}>
            Morning
          </span>
          <Button3 title="Edit" size="sm" />
          <Button title="Add widget" size="sm" />
        </div>
        <div className="grid grid-cols-2 gap-3 p-4">
          <Card padding="p-3">
            <div className="flex flex-col">
              <span className={`text-xs font-semibold pb-1 ${t.text}`}>
                Today
              </span>
              {ROWS.map(([time, what, TagN, label]) => (
                <div
                  key={time}
                  className={`flex flex-row items-center gap-2 py-1.5 border-t ${t.hairline}`}
                >
                  <span className={`text-xs w-12 ${t.muted}`}>{time}</span>
                  <span className={`text-xs flex-1 ${t.text}`}>{what}</span>
                  <TagN text={label} textSize="text-xs" padding="px-2 py-0.5" />
                </div>
              ))}
            </div>
          </Card>
          <Card padding="p-3">
            <div className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${t.text}`}>Inbox</span>
              <span className={`text-2xl font-semibold ${t.text}`}>12</span>
              <span className={`text-xs ${t.muted}`}>3 need a reply</span>
              <ProgressBar value={40} size="sm" />
              <span className={`text-xs font-semibold ${t.accent}`}>
                Open inbox
              </span>
            </div>
          </Card>
          <div className="col-span-2">
            <Card padding="p-3">
              <div className="flex flex-row items-center gap-2">
                <span className={`text-xs font-semibold flex-1 ${t.text}`}>
                  Buttons
                </span>
                <Button title="Button" size="sm" />
                <Button2 title="Button 2" size="sm" />
                <Button3 title="Button 3" size="sm" />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </ThemeContext.Provider>
  );
};

export default NewThemePreview;

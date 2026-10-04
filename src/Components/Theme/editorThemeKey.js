/**
 * Which theme ThemeManagerModal opens on: the one asked for (the Themes
 * page's Edit theme — app-navigation NAV-009 AC3), else the app theme from
 * settings, else the first theme.
 */
export function editorThemeKey({ initialThemeKey = null, settings, themes }) {
  if (!themes) return null;
  if (initialThemeKey && initialThemeKey in themes) return initialThemeKey;
  if (settings && "theme" in settings && settings.theme in themes) {
    return settings.theme;
  }
  return Object.keys(themes)[0] || null;
}

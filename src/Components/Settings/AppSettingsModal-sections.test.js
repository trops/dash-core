/**
 * Settings keeps only true settings (app-navigation PRD NAV-004 AC1):
 * Dashboards, Folders, Providers, Bots, Widgets and Themes are Manage pages
 * in the left nav now. Static pin on the modal's section list.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "AppSettingsModal.js"),
  "utf8",
);

describe("AppSettingsModal — sections", () => {
  const block = src.match(/const SECTIONS = \[([\s\S]*?)\n\];/);

  it("lists General, Account, Notifications, MCP Server, AI Assistant, Privacy & Security", () => {
    expect(block).not.toBeNull();
    const keys = [...block[1].matchAll(/key: "([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual([
      "general",
      "account",
      "notifications",
      "mcp-server",
      "ai-assistant",
      "privacy-security",
    ]);
  });

  it("no longer renders the sections that became Manage pages", () => {
    for (const name of [
      "DashboardsSection",
      "FoldersSection",
      "ProvidersSection",
      "BotsSection",
      "WidgetsSection",
      "ThemesSection",
    ]) {
      expect(src).not.toMatch(new RegExp(`<${name}\\b`));
    }
  });
});

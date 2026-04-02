# PRD: Multi-Page Dashboard Layouts

**Status:** Implemented
**Last Updated:** 2026-04-02
**Owner:** Core Team
**Related PRDs:** [Command Palette Navigation](command-palette-navigation.md), [Layout Builder Hybrid](layout-builder-hybrid.md), [Dashboard Marketplace](dashboard-marketplace.md)
**Repos:** dash-core (v0.1.306+), dash-electron (v0.0.325+)

---

## Executive Summary

Dashboards support multiple pages within a single workspace, each with its own independent grid layout. Pages are navigated via a tab bar and can be added, renamed, reordered (drag-to-reorder), and deleted from the layout builder. Widgets persist across page switches, maintaining event listeners and state. Existing single-page dashboards are backward compatible and auto-migrate when the user adds their first page.

---

## Context & Background

### Problem Statement

Dashboards were limited to a single flat grid layout per workspace. Users who needed to organize many widgets had to either cram everything into one grid or create separate dashboards, losing cross-widget event communication. There was no way to create a multi-view application experience within a single dashboard.

### Current State (Post-Implementation)

- Each workspace can have a `pages` array, where each page owns its own `LayoutGridContainer` with an independent grid
- A `PageTabBar` component renders tabs for switching between pages
- All page widgets stay mounted (hidden via `display: none`) so event listeners, MCP connections, and widget state persist
- Single-page dashboards (no `pages` array) continue to work unchanged

---

## Data Model

### Workspace Model Extension

```javascript
workspace = {
  id: Number,
  name: String,
  // Existing fields...
  layout: Array,        // Legacy single-page layout (backward compat)

  // NEW fields:
  pages: [
    {
      id: String,       // Unique page ID (e.g., "page-1712000000000")
      name: String,     // Display name (shown in tab)
      order: Number,    // Sort order for tab display
      layout: Array,    // Independent LayoutModel items for this page
    },
  ],
  activePageId: String, // Currently active page
}
```

### Migration Rules

- When `pages` is absent or empty, the workspace operates in **single-page mode** using `layout` directly
- When the user clicks "Add Page" on a single-page dashboard:
  1. The existing `layout` is moved into `pages[0]` (named after the workspace)
  2. A new empty page is created as `pages[1]`
- When the user deletes pages down to 1 remaining:
  1. The last page's layout is moved back to the root `layout` field
  2. `pages` is cleared to `[]`
  3. The dashboard returns to single-page mode (no tabs shown)

---

## Features

### Page Management (Edit Mode Only)

| Feature | Behavior |
|---------|----------|
| **Add Page** | "+" button in tab bar creates a new page with a default 1x1 grid |
| **Switch Page** | Click a tab to switch the visible page |
| **Rename Page** | Double-click a tab to inline-edit the page name |
| **Delete Page** | "x" button on tab removes the page (minimum 1 page enforced) |
| **Reorder Pages** | Drag tabs left/right to change order |

### Tab Bar Visibility

| State | Tabs Shown |
|-------|-----------|
| Single page, preview mode | No tabs |
| Single page, edit mode | Tab bar with "Add Page" button only |
| Multiple pages, preview mode | Tabs shown |
| Multiple pages, edit mode | Tabs shown with add/delete/reorder controls |

### Widget Persistence

All pages render their `LayoutGridContainer` simultaneously. Inactive pages use `display: none` rather than unmounting. This means:

- Widget state (React state, refs) persists across page switches
- MCP connections stay alive
- Event pub/sub works across pages (e.g., IndexSelector on Page 1 publishes `indexSelected`, widget on Page 3 receives it)
- No re-initialization cost when switching pages

---

## Architecture

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `PageTabBar` | `src/Components/Navigation/PageTabBar.js` | Tabbed navigation UI with drag-to-reorder |
| `PageLayoutBuilder` | `src/Components/Dashboard/DashboardStage.js` | Memoized LayoutBuilder wrapper per page |
| `DashboardModel.createPage()` | `src/Models/DashboardModel.js` | Static factory for new page objects |
| `WorkspaceModel` | `src/Models/WorkspaceModel.js` | Extended with `pages` and `activePageId` |

### Rendering Flow

```
DashboardStage
  -> PageTabBar (tabs for page switching)
  -> For each page:
       -> <div display={active ? "flex" : "none"}>
            -> PageLayoutBuilder (React.memo)
                 -> LayoutBuilder (with page's layout array)
                      -> renderLayout() (recursive, unchanged)
                           -> LayoutGridContainer (unchanged)
```

### Save Flow

1. Each page's `LayoutBuilder` writes to its own per-page ref
2. On save, `handleClickSaveWorkspace` gathers the latest layout from each page ref
3. Serializes `workspace.pages[].layout` alongside the root workspace
4. `workspaceController` persists the full workspace JSON (no changes needed)

### Load Flow

1. `handleLoadWorkspacesComplete` normalizes page layouts through `LayoutModel()`
2. `WorkspaceModel` preserves `pages` and `activePageId`
3. `DashboardModel` normalizes grids within pages

---

## User Stories

### P0: Must Have (Implemented)

- **US-001:** As a user, I can add a new page to my dashboard so I can organize widgets across multiple views
- **US-002:** As a user, I can switch between pages via tabs so I can navigate my multi-page dashboard
- **US-003:** As a user, each page has its own grid layout so I can configure different layouts per page
- **US-004:** As a user, my widgets on hidden pages maintain their state so I don't lose data when switching pages
- **US-005:** As a user, my existing single-page dashboards work unchanged (backward compatibility)

### P1: Should Have (Implemented)

- **US-006:** As a user, I can rename pages by double-clicking the tab
- **US-007:** As a user, I can reorder pages by dragging tabs
- **US-008:** As a user, I can delete pages (with minimum 1 page enforced)
- **US-009:** As a user, deleting down to 1 page returns to single-page mode

### P2: Nice to Have (Future)

- **US-010:** As a user, I can create multi-page dashboards via MCP tools (`create_dashboard` with `pages` param)
- **US-011:** As a user, I can add widgets to specific pages via MCP (`add_widget` with `page` param)
- **US-012:** As a user, I can have a pinned sidebar that persists across all pages

---

## Implementation Notes

- `PageTabBar` follows the same UI patterns as `DashTabBar` (workspace-level tabs)
- `PageLayoutBuilder` uses `React.memo` and `useMemo` to prevent unnecessary re-renders when the parent re-renders
- Per-page refs (`pageRefsMap`) solve the problem of multiple `LayoutBuilder` instances sharing one `workspaceRef`
- Grid normalization on load runs through `DashboardModel._normalizeAllGrids()` for each page

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-04-02 | 1.0 | Initial implementation — Phases 1-4 complete |

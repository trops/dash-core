# PRD: Enhanced WidgetDropdown with Mac Finder-Style Interface

## Status & Metadata

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| **Status**         | Superseded in the dashboard editor (2026-10-22); the pop-up remains as a fallback outside it |
| **Version**        | 2.0.0                                                    |
| **Author**         | Product Team                                             |
| **Created**        | 2026-02-14                                               |
| **Last Updated**   | 2026-10-22                                               |
| **Target Release** | Phase 1: Q1 2026 (Completed), Phase 2: Q2 2026 (Planned) |
| **Priority**       | P0 - Critical                                            |
| **Component**      | EnhancedWidgetDropdown                                   |
| **Epic**           | Dashboard Builder UX Enhancement                         |

> **Superseded (consolidation Phase 5, 2026-10-22).** In the dashboard editor, an empty cell's **Add widget** now selects the cell and the edit panel's **Add** tab places the widget (`WidgetSidebar`). The widget's connections and settings are set afterwards in the one widget panel, and the card's pill says what's missing (dash-electron create-entry CRE-006, CRE-015). `EnhancedWidgetDropdown` (this PRD) only opens outside the editor, where no edit panel exists. This PRD is kept as the record of how that pop-up works.

---

## Executive Summary

The WidgetDropdown component is the primary interface users interact with to add widgets to their dashboards. This PRD outlines a comprehensive redesign from a basic 384px dropdown to a large-scale, Mac Finder-style interface featuring three-column navigation, advanced filtering (search, author, provider), and rich widget metadata display.

**Key Goals:**

-   Reduce time to add widget from ~15s to <10s
-   Enable discovery by author and provider requirements
-   Prepare foundation for future marketplace/registry integration
-   Create polished, professional widget selection experience

**Success Criteria:**

-   90%+ user satisfaction on "Easy to find and add widgets"
-   Users can find widget by author in <5 seconds
-   Users can filter by provider in <3 seconds

---

## Context & Background

### Problem Statement

The current WidgetDropdown implementation (404 lines, 384px wide inline dropdown) provides basic widget selection but lacks:

-   Advanced filtering capabilities (no author or provider filters)
-   Comprehensive widget information display
-   Professional, polished visual design
-   Scalability for future marketplace integration

**Current Pain Points:**

1. **Limited Discovery:** Search only matches widget name/key, not description or metadata
2. **No Author Filtering:** Users cannot filter widgets by creator
3. **No Provider Filtering:** Cannot find widgets without provider requirements or by specific provider
4. **Minimal Information:** Limited widget details before adding (only icon + name + provider indicator)
5. **Small Interface:** 384px width feels cramped and unprofessional
6. **No Registry Support:** No foundation for future marketplace browsing

### Current Implementation

**File:** `./src/Components/Layout/Builder/Enhanced/WidgetDropdown.js`

**Key Features:**

-   Type filter (widgets only)
-   Search filter (name/key matching)
-   Recent widgets section (localStorage, top 3)
-   Keyboard navigation (arrow keys, Enter to select)
-   384px (w-96) centered modal with backdrop

**Data Source:**

-   `ComponentManager.map()` - Returns all registered widgets
-   Widget metadata: name, key, type, workspace, description, icon, providers[], userConfig, styles, events

### Target Users

1. **Dashboard Creator (Sarah)** - Builds dashboards regularly, needs quick widget discovery
2. **Widget Curator (Alex)** - Manages installed widgets, filters by providers and authors
3. **Explorer (Jordan)** - Browses available widgets, wants detailed info before committing

---

## Goals & Success Metrics

### Business Goals

| Goal                          | Metric                          | Target | Current               |
| ----------------------------- | ------------------------------- | ------ | --------------------- |
| Reduce widget selection time  | Avg. time to add widget         | <10s   | ~15s                  |
| Improve discoverability       | % users finding widget in <30s  | >95%   | ~70%                  |
| Increase user satisfaction    | CSAT score for widget selection | >90%   | ~65%                  |
| Enable filtering capabilities | % users using filters           | >50%   | 0% (no filters exist) |

### Success Metrics

**Primary Metrics:**

-   ⏱️ Time to add widget: <10 seconds (down from ~15s)
-   🔍 Widget discovery by author: <5 seconds
-   ⚡ Provider filtering: <3 seconds
-   😊 User satisfaction: 90%+ approval on "Easy to find and add widgets"

**Secondary Metrics:**

-   Filter usage rate: >50% of widget additions use at least one filter
-   Search usage rate: >80% of users use search
-   Details panel engagement: >90% view details before adding
-   Keyboard navigation usage: >30% power users

**Performance Metrics:**

-   Filter/search response time: <100ms for 100+ widgets
-   Initial render time: <500ms
-   Smooth 60fps column transitions

---

## User Personas

### 1. Dashboard Creator (Sarah)

**Background:**

-   Creates 5-10 dashboards per week
-   Knows which widgets she needs by name
-   Values speed and efficiency
-   Occasionally discovers new widgets

**Goals:**

-   Quickly find and add known widgets
-   Discover new widgets when available
-   Minimal clicks to add widget

**Pain Points:**

-   Current search is slow and limited
-   Can't remember exact widget names
-   No way to filter by use case

**How This Helps:**

-   Fast search across name + description
-   Recent widgets for quick access
-   Keyboard shortcuts for power users

### 2. Widget Curator (Alex)

**Background:**

-   Manages installed widgets for team
-   Needs to understand widget dependencies
-   Filters by provider requirements
-   Reviews widget details before approving

**Goals:**

-   Filter widgets by required providers
-   View comprehensive widget metadata
-   Understand credential requirements

**Pain Points:**

-   No way to see which widgets require which providers
-   Limited widget information in current UI
-   Can't filter by author/creator

**How This Helps:**

-   Provider filter in widget list
-   Detailed provider requirements in details panel
-   Author filter for team-created widgets

### 3. Explorer (Jordan)

**Background:**

-   New to the platform
-   Browses available widgets to learn
-   Wants to understand widget capabilities
-   Needs detailed information before committing

**Goals:**

-   Browse all available widgets
-   Read detailed descriptions
-   Understand configuration options

**Pain Points:**

-   Current UI shows minimal information
-   No way to browse by category or author
-   Can't see configuration options before adding

**How This Helps:**

-   Large details panel with full descriptions
-   Configuration fields preview
-   Author and provider metadata
-   Future: Discover marketplace widgets

---

## User Stories

### Priority 0 (Must Have - MVP)

**US-001: Browse Installed Widgets in Mac Finder Columns**

-   **As a** dashboard creator
-   **I want to** browse installed widgets using Mac Finder-style three-column navigation
-   **So that** I can easily navigate through sources, widget list, and details

**Acceptance Criteria:**

-   ✅ Modal displays three columns: Source | Widget List | Details
-   ✅ Source column shows "Installed" and "Discover" options
-   ✅ Selecting "Installed" displays all installed widgets in middle column
-   ✅ Selecting a widget shows details in right column
-   ✅ Column widths are responsive (20% | 35% | 45%)
-   ✅ Modal is large (80vw x 90vh)

---

**US-002: Search Widgets by Name/Description**

-   **As a** dashboard creator
-   **I want to** search widgets by name or description
-   **So that** I can quickly find widgets without scrolling

**Acceptance Criteria:**

-   ✅ Search input appears in top navigation bar (left side)
-   ✅ Search filters widgets in real-time (on keystroke)
-   ✅ Search matches widget name (case-insensitive)
-   ✅ Search matches widget description (case-insensitive)
-   ✅ Search results update in <100ms
-   ✅ Empty state shows "No widgets found" message
-   ✅ Search input has clear button (X icon)

---

**US-003: Filter Widgets by Author**

-   **As a** widget curator
-   **I want to** filter widgets by author/creator
-   **So that** I can find widgets created by specific team members or vendors

**Acceptance Criteria:**

-   ✅ Author filter dropdown appears in top navigation bar (center)
-   ✅ Dropdown lists all unique authors from installed widgets
-   ✅ Selecting author filters widget list in real-time
-   ✅ Author filter works in combination with search
-   ✅ "All Authors" option clears author filter
-   ✅ Filter shows count of widgets per author

**Note:** Widgets use the `author` field from their configuration. Falls back to `workspace` namespace for widgets without an author field.

---

**US-004: Filter Widgets by Provider Requirements**

-   **As a** widget curator
-   **I want to** filter widgets by required providers (or "none")
-   **So that** I can find widgets compatible with available credentials

**Acceptance Criteria:**

-   ✅ Provider filter dropdown appears in top navigation bar (right side)
-   ✅ Dropdown lists: "All Providers", "None", and all provider types (Slack, Algolia, etc.)
-   ✅ Selecting "None" shows widgets with empty providers array
-   ✅ Selecting provider type shows widgets requiring that provider
-   ✅ Provider filter works in combination with search and author filters
-   ✅ Filter shows count of widgets per provider

---

**US-005: View Detailed Widget Information Before Adding**

-   **As an** explorer
-   **I want to** view comprehensive widget information in details panel
-   **So that** I can make informed decisions before adding

**Acceptance Criteria:**

-   ✅ Details panel displays when widget is selected in list
-   ✅ Shows: Widget icon (large), name, author, version (if available)
-   ✅ Shows: Full description text (scrollable if long)
-   ✅ Shows: Required providers section with:
    -   Provider type
    -   Required vs optional indicator
    -   Credential schema details (OAuth token, workspace URL, etc.)
-   ✅ Shows: Configuration options preview:
    -   Field labels
    -   Field types (text, number, select, etc.)
    -   Default values (if available)
-   ✅ Empty state when no widget selected: "Select a widget to view details"

---

**US-006: Add Widget to Dashboard from Details Panel**

-   **As a** dashboard creator
-   **I want to** add selected widget to dashboard via button in details panel
-   **So that** I can complete the widget selection workflow

**Acceptance Criteria:**

-   ✅ "Add to Dashboard" button appears at bottom of details panel
-   ✅ Button is disabled when no widget selected
-   ✅ Button is enabled when widget selected
-   ✅ Clicking button calls `onSelectWidget(widget)` callback
-   ✅ Modal closes after successful addition
-   ✅ Button shows visual feedback on hover/click

---

**US-007: Browse Marketplace Registry (Future Stub)**

-   **As an** explorer
-   **I want to** browse marketplace registry for discoverable widgets
-   **So that** I can install new widgets from the community

**Acceptance Criteria:**

-   ✅ "Discover" option appears in Source column
-   ✅ Selecting "Discover" calls registry API stub
-   ✅ Stub returns empty array: `Promise.resolve([])`
-   ✅ Empty state displays: "Marketplace coming soon! Check back later for community widgets."
-   ✅ Registry API stub is clearly marked for future implementation
-   ✅ Code structure supports future real registry integration

---

### Priority 1 (Should Have - Post-MVP)

**US-008: Keyboard Navigation Between Columns**

-   **As a** power user
-   **I want to** navigate columns using keyboard shortcuts
-   **So that** I can select widgets faster without mouse

**Acceptance Criteria:**

-   Arrow keys navigate within current column
-   Tab/Shift+Tab move between columns
-   Enter key selects item in current column
-   Escape closes modal

---

**US-009: Recent Widgets Quick Access**

-   **As a** dashboard creator
-   **I want to** see recently added widgets at top of list
-   **So that** I can quickly re-add common widgets

**Acceptance Criteria:**

-   "Recent" section appears at top of Widget List
-   Shows last 3 added widgets (from localStorage)
-   Separated from main list with divider
-   Can be toggled on/off

---

**US-010: Widget List Sorting Options**

-   **As a** widget curator
-   **I want to** sort widget list by name, author, or recently added
-   **So that** I can browse widgets in my preferred order

**Acceptance Criteria:**

-   Sort dropdown at top of Widget List column
-   Options: Name (A-Z), Author (A-Z), Recently Added
-   Sorting persists in localStorage
-   Works with active filters

---

## Feature Requirements

### Functional Requirements

#### 1. Top Navigation Bar

**FR-1.0: Filter Navigation Bar**

-   Position: Top of modal, below title bar
-   Width: Full modal width
-   Contains (horizontal layout, left to right):
    -   Search input (40% width, left-aligned)
    -   Author filter dropdown (25% width)
    -   Provider filter dropdown (25% width)
-   Sticky position (remains visible when scrolling columns)
-   Background: Distinct from column backgrounds (subtle contrast)
-   All filters apply globally to widget list in real-time

#### 2. Three-Column Mac Finder Layout

**FR-2.1: Source Column (Left)**

-   Width: 20% of modal width
-   Fixed width, no scrolling
-   Options:
    -   "Installed" (default selected)
    -   "Discover" (registry stub)
-   Selection indicator (background highlight)
-   Click to switch source

**FR-2.2: Widget List Column (Middle)**

-   Width: 35% of modal width
-   Scrollable (vertical only)
-   Contains:
    -   Widget list (scrollable area)
    -   Widget count indicator (bottom, sticky)
-   Each widget item shows:
    -   Widget name only (clean, simple list)
-   Selected widget has highlight background
-   Hover states for widget items
-   No icons, author info, or provider indicators (keeps list clean and scannable)

**FR-2.3: Details Column (Right)**

-   Width: 45% of modal width
-   Scrollable (vertical only)
-   Contains:
    -   Widget icon (large, 64px)
    -   Widget name (heading)
    -   Author (subheading)
    -   Version (if available, placeholder: "1.0.0")
    -   Divider
    -   Description section (scrollable if long)
    -   Required Providers section (expandable list)
    -   Configuration Options section (preview, expandable)
    -   "Add to Dashboard" button (bottom, sticky)
-   Empty state when no selection: "Select a widget to view details"

#### 3. Filtering System

**FR-3.1: Search Filter**

-   Text input with search icon
-   Placeholder: "Search widgets..."
-   Debounced input (150ms) for performance
-   Matches against:
    -   Widget name (case-insensitive)
    -   Widget key (case-insensitive)
    -   Description (case-insensitive, if available)
-   Shows "X" clear button when text entered
-   Updates widget list in real-time

**FR-3.2: Author Filter**

-   Dropdown select component
-   Extracts unique authors from widgets (using `author` field, falls back to `workspace` if not present)
-   Options:
    -   "All Authors" (default)
    -   Author 1 (widget count)
    -   Author 2 (widget count)
    -   ...
-   Single selection
-   Combines with search and provider filters (AND logic)

**FR-3.3: Provider Filter**

-   Dropdown select component
-   Extracts unique provider types from all widgets
-   Options:
    -   "All Providers" (default)
    -   "None" (widgets with no providers)
    -   Provider Type 1 (widget count)
    -   Provider Type 2 (widget count)
    -   ...
-   Single selection
-   Combines with search and author filters (AND logic)

**FR-3.4: Filter Logic**

-   All filters use AND logic (search AND author AND provider)
-   Empty result set shows: "No widgets match your filters. Try adjusting your search or filters."
-   Filter state persists during modal session
-   Filters reset when modal closes

#### 4. Widget Details Panel

**FR-4.1: Widget Metadata Display**

-   Icon: Large emoji/icon (64x64px)
-   Name: Heading size (text-2xl)
-   Author: Subheading (text-lg) - Format: "by {workspace}"
-   Version: Small text (text-sm) - Placeholder: "Version 1.0.0" (not in current model)
-   Description:
    -   Full text display
    -   Scrollable if longer than available space
    -   Fallback: "No description available" if missing

**FR-4.2: Required Providers Section**

-   Section heading: "Required Providers"
-   Show "None" if providers array is empty
-   For each provider:
    -   Provider type (e.g., "Slack", "Algolia")
    -   Required indicator: "Required" or "Optional"
    -   Expandable credential schema details:
        -   OAuth token
        -   Workspace URL
        -   API keys
        -   Other credential fields
-   Empty state: "This widget does not require any providers."

**FR-4.3: Configuration Options Preview**

-   Section heading: "Configuration Options"
-   Shows user-configurable fields from `userConfig`:
    -   Field label
    -   Field type (text, number, select, boolean, etc.)
    -   Default value (if available)
-   Expandable/collapsible list (default: collapsed)
-   Empty state: "This widget has no user-configurable options."

**FR-4.4: Add to Dashboard Button**

-   Button text: "Add to Dashboard"
-   Position: Bottom of details panel (sticky)
-   States:
    -   Disabled (gray) when no widget selected
    -   Enabled (primary color) when widget selected
    -   Hover state (darker shade)
    -   Loading state (if needed for future async operations)
-   Click behavior:
    -   Calls `onSelectWidget(selectedWidget)`
    -   Closes modal
    -   Shows success feedback (optional toast)

#### 5. Registry Integration Stub

**FR-5.1: Discover Source Option**

-   "Discover" option in Source column
-   Click behavior:
    -   Calls `fetchRegistryWidgets()` stub function
    -   Stub returns: `Promise.resolve([])`
    -   Shows empty state in Widget List column

**FR-5.2: Registry Empty State**

-   Message: "Marketplace coming soon!"
-   Subtext: "Check back later for community-contributed widgets."
-   Optional: Email signup form for marketplace updates (future)
-   Clear visual distinction from "No results" empty state

#### 6. Keyboard Navigation (P1)

**FR-6.1: Arrow Key Navigation**

-   Up/Down: Navigate within current column
-   Left/Right: Move between columns (future enhancement)

**FR-6.2: Shortcuts**

-   Enter: Select highlighted item / Add widget (if in details)
-   Escape: Close modal
-   Tab: Move focus forward
-   Shift+Tab: Move focus backward
-   /: Focus search input (when modal open)

### Non-Functional Requirements

#### Performance

-   **NFR-1.1:** Filter/search operations complete in <100ms for up to 100 widgets
-   **NFR-1.2:** Initial modal render in <500ms
-   **NFR-1.3:** Smooth 60fps animations for column transitions
-   **NFR-1.4:** Debounced search input (150ms) to prevent excessive re-renders

#### Scalability

-   **NFR-2.1:** Support up to 500 widgets without performance degradation
-   **NFR-2.2:** Virtualized scrolling for widget list (if needed for >100 widgets)
-   **NFR-2.3:** Efficient filter algorithms (avoid nested loops)

#### Accessibility

-   **NFR-3.1:** ARIA labels for all interactive elements
-   **NFR-3.2:** Keyboard navigation support (Tab, arrow keys, Enter, Escape)
-   **NFR-3.3:** Screen reader support (ARIA live regions for filter results)
-   **NFR-3.4:** Focus management (auto-focus search on open, restore focus on close)
-   **NFR-3.5:** Color contrast meets WCAG 2.1 AA standards

#### Responsive Design

-   **NFR-4.1:** Modal size: 80vw x 90vh
-   **NFR-4.2:** Column proportions: 20% | 35% | 45%
-   **NFR-4.3:** Minimum modal width: 1000px (below which, show simplified mobile view - future)
-   **NFR-4.4:** Column widths adjust proportionally on window resize

#### Compatibility

-   **NFR-5.1:** Works in Electron environment (Chromium-based)
-   **NFR-5.2:** React 18 compatible
-   **NFR-5.3:** Integrates with existing dash-react theme system
-   **NFR-5.4:** Compatible with existing ComponentManager API

---

## User Workflows

### Workflow 1: Quick Add Known Widget

**Actor:** Dashboard Creator (Sarah)

**Preconditions:** User is in dashboard builder, clicks "Add Widget" button

**Steps:**

1. User clicks "Add Widget" button
2. WidgetDropdown modal opens (80vw x 90vh)
3. "Installed" source is pre-selected
4. Widget list shows all installed widgets
5. User types "analytics" in search input
6. Widget list filters to matching widgets in real-time (<100ms)
7. User clicks "Analytics Widget" in list
8. Details panel shows comprehensive widget info
9. User reviews details (optional)
10. User clicks "Add to Dashboard" button
11. Modal closes, widget added to dashboard

**Postconditions:** Widget is added to dashboard, modal is closed

**Success Criteria:** Entire workflow completes in <10 seconds

---

### Workflow 2: Filter by Provider Requirements

**Actor:** Widget Curator (Alex)

**Preconditions:** User wants to add a widget that doesn't require providers

**Steps:**

1. User opens WidgetDropdown modal
2. "Installed" source is selected
3. User clicks Provider filter dropdown
4. User selects "None" from dropdown
5. Widget list updates to show only widgets without provider requirements
6. User reviews filtered list (e.g., 5 widgets without providers)
7. User selects "Simple Counter Widget"
8. Details panel confirms "This widget does not require any providers."
9. User clicks "Add to Dashboard"
10. Modal closes, widget added

**Postconditions:** Widget without providers is added, user confirmed no credential setup needed

**Success Criteria:** User finds and adds no-provider widget in <5 seconds

---

### Workflow 3: Explore Widget Details Before Adding

**Actor:** Explorer (Jordan)

**Preconditions:** User is new to platform, wants to explore available widgets

**Steps:**

1. User opens WidgetDropdown modal
2. User browses widget list (scrolls through ~20 widgets)
3. User clicks "Slack Integration Widget"
4. Details panel displays:
    - Icon: 💬
    - Name: "Slack Integration Widget"
    - Author: "by slack-workspace"
    - Version: "1.0.0"
    - Description: "Display Slack messages and notifications in real-time..."
    - Required Providers:
        - Slack (Required)
            - OAuth token
            - Workspace URL
    - Configuration Options:
        - Channel ID (text)
        - Message limit (number, default: 10)
        - Show avatars (boolean, default: true)
5. User reads description and provider requirements
6. User decides widget requires too much setup
7. User clicks different widget in list (e.g., "Simple Notes")
8. Details panel updates to show new widget info
9. User confirms this widget has no providers
10. User clicks "Add to Dashboard"

**Postconditions:** User explored multiple widgets, made informed decision, added widget

**Success Criteria:** User can view detailed info for 3+ widgets before deciding which to add

---

### Workflow 4: Filter by Author

**Actor:** Widget Curator (Alex)

**Preconditions:** User wants to find widgets created by specific team member

**Steps:**

1. User opens WidgetDropdown modal
2. User clicks Author filter dropdown
3. Dropdown shows:
    - All Authors
    - analytics-workspace (8 widgets)
    - slack-workspace (3 widgets)
    - custom-workspace (5 widgets)
4. User selects "analytics-workspace"
5. Widget list updates to show only 8 widgets from that workspace
6. User browses filtered list
7. User selects "Revenue Dashboard Widget"
8. User clicks "Add to Dashboard"

**Postconditions:** User found team-created widget using author filter

**Success Criteria:** User filters by author in <3 seconds

---

### Workflow 5: Discover Marketplace (Future)

**Actor:** Explorer (Jordan)

**Preconditions:** User wants to explore community widgets

**Steps:**

1. User opens WidgetDropdown modal
2. User clicks "Discover" in Source column
3. System calls `fetchRegistryWidgets()` stub
4. Stub returns empty array: `[]`
5. Widget List column shows empty state:
    - "Marketplace coming soon!"
    - "Check back later for community-contributed widgets."
6. User understands feature is not yet available
7. User clicks "Installed" to return to installed widgets

**Postconditions:** User understands marketplace is planned but not available

**Success Criteria:** Empty state clearly communicates future availability

---

## Design Considerations

### Visual Design

**Overall Layout:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Widget Selector                                                   [X Close] │
├─────────────────────────────────────────────────────────────────────────────┤
│  🔍 Search widgets...     👤 Author: All ▼     ⚡ Provider: All ▼           │
├────────────┬──────────────────────────┬──────────────────────────────────────┤
│            │                          │                                      │
│  Source    │  Widget List             │  Widget Details                      │
│  (20%)     │  (35%)                   │  (45%)                               │
│            │                          │                                      │
│ >Installed │  Analytics Widget        │  [Empty: Select a widget]            │
│  Discover  │  Slack Widget            │                                      │
│            │  Notifications           │  OR                                  │
│            │  Revenue Dashboard       │                                      │
│            │  Customer Metrics        │  📦 Analytics Widget                 │
│            │  Task List               │  by analytics-workspace              │
│            │  Calendar View           │  Version 1.0.0                       │
│            │  Notes Widget            │                                      │
│            │  File Browser            │  ──────────────────                  │
│            │  Weather Widget          │                                      │
│            │  News Feed               │  Description:                        │
│            │  Stock Ticker            │  A comprehensive analytics widget... │
│            │                          │  (scrollable)                        │
│            │  (scrollable)            │                                      │
│            │                          │  Required Providers:                 │
│            │  ──────────────────      │  None                                │
│            │  12 widgets              │                                      │
│            │                          │  Configuration Options:              │
│            │                          │  ▸ Title (text)                      │
│            │                          │  ▸ Refresh rate (number)             │
│            │                          │  ▸ Theme (select)                    │
│            │                          │                                      │
│            │                          │  [🎯 Add to Dashboard]               │
│            │                          │                                      │
└────────────┴──────────────────────────┴──────────────────────────────────────┘
```

**Color Scheme:**

-   Background: Use dash-react Panel component (theme-aware)
-   Selected items: Primary accent color (e.g., blue-500)
-   Hover states: Lighter shade (e.g., blue-100 in light mode)
-   Text: High contrast for readability
-   Dividers: Subtle gray (border-gray-300)

**Typography:**

-   Modal title: text-2xl font-semibold
-   Widget name (list): text-base font-medium
-   Widget metadata (list): text-sm text-gray-500
-   Widget name (details): text-3xl font-bold
-   Section headings: text-lg font-semibold
-   Body text: text-base

**Spacing:**

-   Column padding: p-4
-   Widget list items: py-3 px-4
-   Section spacing: mb-6
-   Modal padding: p-6

**Interaction States:**

-   Default: Base styles
-   Hover: Background highlight (bg-gray-100)
-   Selected: Primary accent background (bg-blue-500) with white text
-   Disabled: Opacity 50%, cursor not-allowed
-   Focus: Ring outline (ring-2 ring-blue-500)

### Component Hierarchy

```
EnhancedWidgetDropdown (Modal)
├── ModalHeader
│   ├── Title: "Widget Selector"
│   └── CloseButton
├── FilterNavigationBar (sticky, full width)
│   ├── SearchInput (40% width, left)
│   ├── AuthorFilter (25% width, center)
│   └── ProviderFilter (25% width, right)
├── ModalBody (Three Columns)
│   ├── SourceColumn (20%)
│   │   ├── SourceOption: "Installed" (selected)
│   │   └── SourceOption: "Discover"
│   ├── WidgetListColumn (35%)
│   │   ├── WidgetList (scrollable)
│   │   │   ├── WidgetListItem
│   │   │   │   └── Name (text only, clean list)
│   │   │   └── ... (more items)
│   │   └── WidgetCount: "12 widgets"
│   └── DetailsColumn (45%)
│       ├── WidgetIcon (large)
│       ├── WidgetName
│       ├── WidgetAuthor
│       ├── WidgetVersion
│       ├── Divider
│       ├── DescriptionSection
│       ├── ProvidersSection
│       │   └── ProviderList
│       │       ├── ProviderItem
│       │       │   ├── ProviderType
│       │       │   ├── RequiredIndicator
│       │       │   └── CredentialSchema (expandable)
│       │       └── ... (more providers)
│       ├── ConfigOptionsSection
│       │   └── ConfigList (expandable)
│       │       ├── ConfigField
│       │       │   ├── Label
│       │       │   ├── Type
│       │       │   └── Default
│       │       └── ... (more fields)
│       └── AddButton: "Add to Dashboard"
└── ModalBackdrop
```

### Data Flow

```
1. User opens modal
   ↓
2. EnhancedWidgetDropdown component mounts
   ↓
3. Fetch installed widgets from ComponentManager.map()
   ↓
4. Set initial state:
   - selectedSource: "Installed"
   - widgets: [array of widget objects]
   - filteredWidgets: [same array, unfiltered]
   - selectedWidget: null
   - searchQuery: ""
   - authorFilter: "All Authors"
   - providerFilter: "All Providers"
   ↓
5. User interacts with filters
   ↓
6. Update state (searchQuery, authorFilter, or providerFilter)
   ↓
7. Re-compute filteredWidgets using AND logic:
   - Filter by search (matches name, key, description)
   - Filter by author (matches workspace)
   - Filter by provider (matches provider type or "none")
   ↓
8. Update WidgetListColumn with filteredWidgets
   ↓
9. User selects widget from list
   ↓
10. Update selectedWidget state
    ↓
11. DetailsColumn displays selectedWidget metadata
    ↓
12. User clicks "Add to Dashboard"
    ↓
13. Call onSelectWidget(selectedWidget) callback
    ↓
14. Close modal
```

### Technology Choices

**Component Library:**

-   **CRITICAL:** Use existing dash-react components exclusively (Panel, Button, Modal, InputText, etc.)
-   **Theme Integration:** All components MUST use ThemeContext to respect user's selected theme
-   **Required Components from dash-react:**
    -   `Modal` - Base modal wrapper
    -   `Panel` / `Panel2` / `Panel3` - Column containers and sections
    -   `Button` - "Add to Dashboard" button
    -   `InputText` - Search input
    -   `SelectMenu` - Author and Provider filter dropdowns
    -   `Heading` / `SubHeading` - Typography
    -   Typography components for text rendering
-   **Why dash-react components:**
    -   Automatic theme integration (light/dark mode support)
    -   Consistent styling with rest of application
    -   Built-in responsive behavior
    -   Accessibility features (ARIA labels, keyboard support)

**State Management:**

-   Local component state (useState hooks)
-   Access ThemeContext via `useContext(ThemeContext)` for currentTheme
-   No need for global state (Redux/Context) for widget list data

**Data Fetching:**

-   Synchronous: `ComponentManager.map()` for installed widgets
-   Asynchronous stub: `Promise.resolve([])` for registry (future)

**Filtering Logic:**

-   Pure JavaScript array methods (filter, some, includes)
-   Debounced search input (lodash.debounce or custom hook)

**Performance Optimizations:**

-   Memoized filter functions (useMemo)
-   Virtualized scrolling (react-window) if >100 widgets (future)
-   Debounced search (150ms delay)

---

## Open Questions & Decisions

### Decisions Made

| Decision                                | Rationale                                                                              | Date       |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ---------- |
| Use workspace field as proxy for author | Widget model doesn't have dedicated author field; workspace provides namespace context | 2026-02-14 |
| 80vw x 90vh modal size                  | Large enough to feel prominent without overwhelming screen                             | 2026-02-14 |
| Three-column Mac Finder layout          | Familiar pattern, supports hierarchical navigation                                     | 2026-02-14 |
| AND logic for filters                   | More intuitive for users to narrow results progressively                               | 2026-02-14 |
| Registry stub returns empty array       | Future-proof architecture, minimal implementation overhead                             | 2026-02-14 |

### Open Questions

| Question                                                      | Impact                                 | Decision Needed By |
| ------------------------------------------------------------- | -------------------------------------- | ------------------ |
| Should we add widget categories/tags to model?                | Medium - would enable better filtering | Phase 2 planning   |
| Should author filter show workspace or extract from metadata? | Low - affects display only             | Week 1             |
| Do we need widget version numbers in current model?           | Low - can use placeholder "1.0.0"      | Week 1             |
| Should configuration preview be expandable or always visible? | Low - affects UX and scroll length     | Week 4             |
| Should we track widget usage stats (e.g., most popular)?      | Medium - could enhance sorting         | Phase 2 planning   |
| Should recent widgets be global or per-dashboard?             | Low - affects localStorage structure   | Week 2             |

---

---

## Phase 2 Enhancements: Configure Before Add

### Status Update

**Phase 1:** ✅ **COMPLETED** (Three-column layout, filtering, basic widget selection)

**Phase 2:** Partly built, then superseded (2026-10-22). Built in `EnhancedWidgetDropdown`: picking a provider for each required one, with a new provider made inline (US-P2-001); the widget's settings, with required fields checked (US-P2-002); and Recent with saved providers and settings (US-P2-003). Not re-checked: the 2-column layout and the responsive layout (US-P2-004, US-P2-005); the file's header comment still describes three columns. In the dashboard editor, an empty cell's **Add widget** now selects the cell and the edit panel's **Add** tab places the widget (`WidgetSidebar`). The widget's connections and settings are set afterwards in the one widget panel, and the card's pill says what's missing (dash-electron create-entry CRE-006, CRE-015). The editor adds first and fixes after; there is no "configure before add" there.

### Overview

Phase 2 transforms the EnhancedWidgetDropdown from a selection interface into a complete "configure and add" workflow. Instead of adding widgets first and configuring them later, users can now configure all provider credentials and widget settings before adding the widget to their dashboard.

**Key Goals:**

-   Reduce post-add configuration steps from 3-5 to 0
-   Enable quick re-use of frequently-used widgets with saved configurations
-   Streamline layout from 3 columns to 2 columns for better space utilization
-   Provide responsive design for smaller screens (<1024px)

**Success Metrics:**

-   Time to add configured widget: <15 seconds (includes provider and config setup)
-   Recent widgets re-add time: <3 seconds (one-click from history)
-   Provider configuration success rate: >95% (before widget addition)
-   User satisfaction with "configure before add" workflow: >90%

### Phase 2 Feature Requirements

#### 1. Layout Simplification: 3-Column → 2-Column

**Current Layout (Phase 1):**

```
┌───────────┬────────────┬─────────────┐
│ Source    │ Widget     │ Details     │
│ Installed │ List       │             │
│ Discover  │            │             │
└───────────┴────────────┴─────────────┘
```

**New Layout (Phase 2):**

```
┌─────────────────────────────────────┐
│ [Search] [Author▼] [Provider▼] [Source▼: Installed] │
├──────────────┬──────────────────────┤
│ Widget List  │ Configure & Add      │
│              │                      │
│ • Widget 1   │ 📦 Widget Name       │
│ • Widget 2   │ by Author            │
│              │                      │
│              │ ⚙️ PROVIDERS         │
│              │ Slack: [Select▼]     │
│              │                      │
│              │ ⚙️ CONFIGURATION     │
│              │ Title: [_____]       │
│              │ SubTitle: [_____]    │
│              │                      │
│              │ [Add to Dashboard]   │
└──────────────┴──────────────────────┘
```

**FR-2.1: Source Selector Moved to Filter Bar**

-   Move "Installed/Discover" from left column to filter bar (rightmost position)
-   Dropdown format instead of column selection
-   Options: "Installed" (default), "Discover"
-   Works in combination with other filters

**FR-2.2: Two-Column Layout**

-   Column 1: Widget List (50% width)
-   Column 2: Configure & Add Panel (50% width)
-   Filters: Horizontal bar above columns (Search | Author | Provider | Source)

**FR-2.2.1: Widget List Ordering and Prioritization**

-   Prioritize "Installed" widgets over "Discover" widgets in search results
-   When Source filter shows combined results (if "All Sources" option is implemented):
    -   Installed widgets appear first (alphabetically sorted within group)
    -   Then Discover/Registry widgets (alphabetically sorted within group)
-   Maintains alphabetical sorting within each source group
-   Optional visual separator between Installed and Discover sections (divider line or section heading)
-   Current implementation (Phase 1): Only one source shown at a time, no mixing
-   Future enhancement: "All Sources" filter option to show combined, prioritized list

**FR-2.3: Responsive Design**

Large screens (≥1024px):

```
┌────────────────┬──────────────────────────────────┐
│ Description    │ [Search] [Author] [Provider] [Source] │
│ (1/3)          ├──────────────┬───────────────────┤
│                │ Widget List  │ Configure & Add   │
│ Add Widget to  │              │                   │
│ Dashboard      │ • Widget 1   │ 📦 Widget Name    │
│                │ • Widget 2   │                   │
│ Browse and...  │              │ PROVIDERS         │
│                │              │ CONFIGURATION     │
└────────────────┴──────────────┴───────────────────┘
```

Small screens (<1024px):

```
┌──────────────────────────────────────────┐
│ [Search] [Author] [Provider] [Source]    │
├────────────────┬─────────────────────────┤
│ Widget List    │ Configure & Add         │
│                │                         │
│ • Widget 1     │ 📦 Widget Name          │
│ • Widget 2     │                         │
│                │ PROVIDERS               │
│                │ CONFIGURATION           │
└────────────────┴─────────────────────────┘
```

**Implementation:**

-   Use Tailwind responsive utility: `hidden lg:flex` on left descriptive area
-   Adjust widget navigation width: `w-full lg:w-2/3`
-   Modal remains centered and maintains `w-11/12 xl:w-5/6` width
-   Smooth CSS transitions when toggling visibility

#### 2. Provider Configuration in Details Panel

**FR-3.1: Provider Selection Dropdowns**

**Current Flow (Phase 1):**

1. User clicks "Add to Dashboard"
2. Widget added with missing providers
3. ProviderBadge shows "Configure" button
4. User clicks badge → ProviderSelector modal opens
5. User selects/creates provider

**New Flow (Phase 2):**

1. User selects widget
2. Details panel shows provider dropdowns
3. User selects existing provider OR clicks "Create New"
4. If "Create New" → ProviderForm inline (or mini-modal)
5. User clicks "Add to Dashboard" → widget added with providers configured

**UI Components:**

-   Section heading: "REQUIRED PROVIDERS"
-   For each required provider:
    -   Provider type label (e.g., "Slack")
    -   Dropdown select component:
        -   Option: "-- Select Provider --" (placeholder)
        -   Options: List of existing providers of matching type (e.g., "slack-prod", "slack-dev")
        -   Option: "+ Create New {type}" (special value: `__create_new__`)
    -   Required indicator (red text) if provider is required and not selected
    -   Validation: Show error if required provider not selected before adding

**State Management:**

```javascript
const [selectedProviders, setSelectedProviders] = useState({});
// { "slack": "slack-prod", "algolia": "algolia-dev" }

const [showProviderForm, setShowProviderForm] = useState(null);
// { type: "slack", credentialSchema: {...} } when creating new

const handleProviderSelect = (providerType, providerName) => {
    if (providerName === "__create_new__") {
        setShowProviderForm({
            type: providerType,
            credentialSchema: selectedWidget.providers.find(
                (p) => p.type === providerType
            ).credentialSchema,
        });
    } else {
        setSelectedProviders({
            ...selectedProviders,
            [providerType]: providerName,
        });
    }
};
```

**FR-3.2: Inline Provider Creation**

-   When user selects "+ Create New {type}":
    -   Show ProviderForm component inline or as mini-modal overlay
    -   Reuse existing ProviderForm component from `./src/Components/Provider/ProviderForm.js`
    -   User fills credential fields (OAuth token, workspace URL, etc.)
    -   On save:
        -   Call `dashApi.saveProvider(providerData)`
        -   Update AppContext.providers list
        -   Auto-select newly created provider in dropdown
        -   Close provider form
        -   Return focus to details panel

**FR-3.3: Provider Validation**

-   Before allowing "Add to Dashboard":
    -   Check all required providers have selections
    -   Show validation errors if missing
    -   Disable "Add to Dashboard" button if validation fails
    -   Visual indicators (red border, error text) for incomplete fields

#### 3. userConfig Fields in Details Panel

**FR-4.1: Configuration Fields Section**

-   Section heading: "CONFIGURATION"
-   Display all userConfig fields from widget definition
-   For each field:
    -   Field label (use `displayName` or fallback to `key`)
    -   Required indicator (\*) if field is required
    -   Input component based on field type:
        -   `text`: Text input field
        -   `number`: Number input field
        -   `select`: Dropdown with options
        -   `boolean`: Checkbox or toggle
    -   Placeholder or default value display
    -   Instructions text (if provided in field config)
-   Empty state: "This widget has no configuration options." (hide section entirely)

**UI Components:**

```javascript
// Text field example
<div className="space-y-1">
    <label className="text-sm font-medium">
        Title <span className="text-red-400">*</span>
    </label>
    <input
        type="text"
        placeholder="My Dashboard"
        value={userConfigValues["title"] || ""}
        onChange={(e) => handleConfigChange("title", e.target.value)}
        className="w-full px-3 py-2 rounded text-sm bg-gray-700 border"
    />
    <p className="text-xs text-gray-400">
        The title displayed at the top of the widget
    </p>
</div>
```

**State Management:**

```javascript
const [userConfigValues, setUserConfigValues] = useState({});
// { "title": "My Custom Title", "subTitle": "Custom subtitle" }

const handleConfigChange = (key, value) => {
    setUserConfigValues({ ...userConfigValues, [key]: value });
};
```

**FR-4.2: Configuration Validation**

-   Before allowing "Add to Dashboard":
    -   Check all required userConfig fields are filled
    -   Validate field types (number fields contain numbers, etc.)
    -   Show validation errors if missing or invalid
    -   Disable "Add to Dashboard" button if validation fails
    -   Visual indicators for incomplete/invalid fields

**FR-4.3: Add to Dashboard with Configuration**

```javascript
const handleAddWidget = () => {
    // Validate providers
    if (!validateProviders()) {
        // Show error message
        return;
    }

    // Validate userConfig
    if (!validateUserConfig()) {
        // Show error message
        return;
    }

    // Save to recent widgets
    saveToRecent(selectedWidget, selectedProviders, userConfigValues);

    // Call parent callback with full configuration
    onSelectWidget({
        ...selectedWidget,
        selectedProviders, // Provider selections
        userConfigValues, // User configuration
    });

    // Close modal
    onClose();
};
```

#### 4. Recent Widgets Feature

**FR-5.1: Recent Widgets Storage**

**localStorage Structure:**

```javascript
// Key: "recentWidgets"
[
    {
        widgetKey: "MyFirstWidgetWidget",
        timestamp: 1699564800000,
        providers: {
            slack: "slack-prod",
            algolia: "algolia-dev",
        },
        userConfig: {
            title: "My Dashboard",
            subTitle: "Analytics",
        },
    },
    // ... max 10 items
];
```

**Storage Logic:**

-   Track last 10 recently added widgets
-   Store widget key + providers + userConfig
-   Newest widgets at front of array
-   Deduplicate by widget key (update timestamp if re-added)
-   Persist across sessions
-   Clear on logout (optional)

**FR-5.2: Recent Widgets UI Display**

-   Section heading: "RECENT WIDGETS" (at top of Widget List column)
-   Show last 3-5 recently added widgets
-   Visual indicator: Clock icon (🕒) or "Recent" badge
-   Separated from main widget list with divider/border
-   Click behavior: Auto-populate providers and userConfig in details panel

**UI Components:**

```javascript
{
    recentWidgets.length > 0 && (
        <div className="mb-3 border-b border-gray-700 pb-3">
            <Paragraph className="text-xs font-semibold text-gray-400 mb-2 px-2">
                RECENT WIDGETS
            </Paragraph>
            <Menu3 scrollable={false} padding={true}>
                {recentWidgets.map((widget) => (
                    <MenuItem3
                        key={widget.key}
                        onClick={() => handleRecentClick(widget)}
                        selected={selectedWidget?.key === widget.key}
                    >
                        <div className="flex items-center space-x-2">
                            <span className="text-xs">🕒</span>
                            <div className="text-sm font-medium">
                                {widget.name}
                            </div>
                        </div>
                    </MenuItem3>
                ))}
            </Menu3>
        </div>
    );
}
```

**FR-5.3: Recent Widgets Interaction**

-   Click on recent widget:
    -   Load widget data
    -   Pre-populate `selectedProviders` from recent entry
    -   Pre-populate `userConfigValues` from recent entry
    -   Display in details panel with all fields filled
    -   User can modify and re-add, or add as-is
-   Result: One-click widget addition with saved configuration (~3 seconds)

**Implementation:**

```javascript
const loadRecentWidgets = () => {
    const recent = JSON.parse(localStorage.getItem("recentWidgets") || "[]");
    return recent.slice(0, 5).map((entry) => {
        const widget = allWidgets[entry.widgetKey];
        return {
            ...widget,
            savedProviders: entry.providers,
            savedUserConfig: entry.userConfig,
        };
    });
};

const handleRecentClick = (recentWidget) => {
    setSelectedWidget(recentWidget);
    setSelectedProviders(recentWidget.savedProviders || {});
    setUserConfigValues(recentWidget.savedUserConfig || {});
};
```

### Phase 2 User Stories

**US-P2-001: Configure Provider Before Adding Widget**

-   **As a** dashboard creator
-   **I want to** select or create provider credentials before adding a widget
-   **So that** my widget is fully configured when added to the dashboard

**Acceptance Criteria:**

-   ✅ Details panel shows provider dropdown for each required provider
-   ✅ Dropdown lists existing providers of matching type
-   ✅ "+ Create New" option opens provider creation form
-   ✅ Created provider is auto-selected in dropdown
-   ✅ Validation prevents adding widget without required providers
-   ✅ Widget is added with provider configuration already set

---

**US-P2-002: Fill Widget Configuration Before Adding**

-   **As a** dashboard creator
-   **I want to** fill widget configuration fields (Title, SubTitle, etc.) before adding
-   **So that** I don't have to configure the widget after it's added

**Acceptance Criteria:**

-   ✅ Details panel shows all userConfig fields from widget definition
-   ✅ Text, number, select, and boolean field types are supported
-   ✅ Required fields are marked with \* indicator
-   ✅ Validation prevents adding widget with missing required fields
-   ✅ Widget is added with user configuration already set

---

**US-P2-003: Quick Re-Add Recent Widgets**

-   **As a** dashboard creator who frequently adds the same widgets
-   **I want to** see recently added widgets with saved configurations
-   **So that** I can quickly re-add them without reconfiguring

**Acceptance Criteria:**

-   ✅ "Recent Widgets" section appears at top of widget list
-   ✅ Shows last 3-5 recently added widgets with clock icon
-   ✅ Clicking recent widget auto-populates providers and config
-   ✅ User can modify and re-add, or add as-is
-   ✅ Recent widgets persist across sessions (localStorage)
-   ✅ Re-adding recent widget takes <3 seconds

---

**US-P2-004: Streamlined 2-Column Layout**

-   **As a** dashboard creator
-   **I want to** see more of the widget list and configuration panel
-   **So that** I can make selections and configurations more efficiently

**Acceptance Criteria:**

-   ✅ Source selector moved to filter bar (rightmost dropdown)
-   ✅ Layout simplified to 2 columns (Widget List | Configure & Add)
-   ✅ Widget list column is 50% width, details panel is 50% width
-   ✅ Filter bar includes: Search | Author | Provider | Source

---

**US-P2-005: Responsive Layout for Small Screens**

-   **As a** user on a smaller display
-   **I want to** see the widget selector adapt to my screen size
-   **So that** I can use the feature effectively without excessive scrolling

**Acceptance Criteria:**

-   ✅ On large screens (≥1024px): Left descriptive area visible (1/3), navigation (2/3)
-   ✅ On small screens (<1024px): Left descriptive area hidden, navigation full width
-   ✅ Transition is smooth and automatic based on viewport width
-   ✅ Modal remains centered and maintains responsive width

### Phase 2 Data Flow

```
1. User selects widget from list
   ↓
2. Details panel shows:
   - Widget info (icon, name, author, description)
   - Provider dropdowns (if widget requires providers)
   - userConfig fields (if widget has userConfig)
   ↓
3. User selects providers OR clicks "Create New"
   ↓
4a. If "Create New": Show ProviderForm (inline or modal)
    → User fills credentials → Save to API → Update context → Auto-select
   ↓
4b. User fills userConfig fields (title, subtitle, etc.)
   ↓
5. User clicks "Add to Dashboard"
   ↓
6. Validation:
   - All required providers selected? ✓
   - All required userConfig fields filled? ✓
   ↓
7. If valid:
   - Save to recent widgets (localStorage)
   - Call onSelectWidget({ widget, selectedProviders, userConfigValues })
   - Parent (LayoutBuilder) creates widget instance with config
   - Close modal
   ↓
8. If invalid:
   - Show validation errors
   - Highlight missing fields
   - Keep modal open
```

### Phase 2 Integration Points

**Existing Components to Reuse:**

-   `./src/Components/Provider/ProviderSelector.js` - Provider selection modal (reference for patterns)
-   `./src/Components/Provider/ProviderForm.js` - Provider creation form (reuse directly)
-   `./src/Api/ElectronDashboardApi.ts` - Provider CRUD API

**API Methods:**

-   `dashApi.saveProvider(providerData)` - Create new provider
-   `dashApi.getProviders()` - Get all available providers (used to populate dropdowns)

**Context:**

-   `AppContext.providers` - List of all available providers (updated after creation)
-   `ThemeContext.currentTheme` - Theme styling for form components

**Storage:**

-   `localStorage.recentWidgets` - Recent widgets with configuration (JSON array, max 10 items)

---

## Out of Scope

The following features are explicitly **out of scope** for this PRD and will be considered for future iterations:

1. **Marketplace/Registry Implementation**

    - Actual API integration with widget marketplace
    - Widget installation from registry
    - Widget version management and updates

2. **Advanced Widget Features**

    - Widget ratings and reviews
    - Widget screenshots/preview images
    - Widget categories and tagging system
    - Widget popularity metrics

3. **Advanced Filtering**

    - Multi-select filters (e.g., select multiple authors)
    - Filter by widget size/complexity
    - Filter by last updated date
    - Custom filter combinations (OR logic)

4. **Enhanced Metadata**

    - Adding author field to widget model
    - Adding version field to widget model
    - Adding repository URL to widget model
    - Adding documentation link to widget model

5. **Mobile/Responsive**

    - Mobile-optimized view (<1000px width)
    - Touch gestures for column navigation
    - Simplified single-column view for small screens

6. **Advanced UX**

    - Widget preview before adding (live rendering)
    - Drag-and-drop widget addition
    - Bulk widget addition (add multiple at once)
    - Widget comparison view (side-by-side)

7. **Analytics**
    - Track which widgets are most added
    - Track filter usage patterns
    - A/B testing different layouts

---

## Implementation Phases

### Phase 1: Three-Column Layout & Navigation ✅ COMPLETED

**Goal:** Create foundational three-column structure with basic navigation

**Status:** ✅ **COMPLETED** - Implemented in `./src/Components/Layout/Builder/Enhanced/EnhancedWidgetDropdown.js`

**Completed Tasks:**

1. ✅ Created `EnhancedWidgetDropdown` component file
2. ✅ Implemented Modal wrapper using dash-react Modal component (80vw x 90vh)
3. ✅ Built three-column grid layout (25% | 33% | 42% actual implementation)
4. ✅ Implemented SourceColumn component ("Installed" and "Discover" options)
5. ✅ Implemented WidgetListColumn with scrollable container
6. ✅ Implemented DetailsColumn with scrollable container
7. ✅ Wired up ComponentManager.map() data fetching
8. ✅ Basic widget list rendering (name only, clean list using Menu3/MenuItem3)
9. ✅ Widget selection state management
10. ✅ Modal open/close behavior
11. ✅ Theme integration via ThemeContext

**Deliverables:**

-   ✅ `EnhancedWidgetDropdown.js` component (459 lines)
-   ✅ Three-column Mac Finder-style layout
-   ✅ Basic navigation and selection

---

### Phase 2: Advanced Filtering ✅ COMPLETED

**Goal:** Implement search, author, and provider filters

**Status:** ✅ **COMPLETED** - All filters functional in EnhancedWidgetDropdown

**Completed Tasks:**

1. ✅ Added SearchInput to top navigation bar (lines 196-202)
2. ✅ Implemented search filter logic (lines 105-134)
    - Filters by widget name (case-insensitive)
    - Filters by widget key
    - Filters by description
3. ✅ Added AuthorFilter dropdown (lines 205-216)
    - Extracts unique authors from widgets (lines 81-88)
    - Shows "All Authors" + author list
4. ✅ Implemented author filter logic (lines 116-118)
5. ✅ Added ProviderFilter dropdown (lines 219-230)
    - Extracts unique provider types (lines 91-102)
    - "All Providers", "None", + provider list
6. ✅ Implemented provider filter logic (lines 121-130)
    - "None" matches empty providers array
    - Provider type matching
7. ✅ Combined filters with AND logic (line 132)
8. ✅ WidgetListColumn shows filtered results
9. ✅ Empty state handling (lines 281-289)

**Deliverables:**

-   ✅ Search, author, and provider filter components
-   ✅ Filter logic functions (getFilteredWidgets)
-   ✅ Real-time filtered widget list rendering

---

### Phase 3: Widget Details Panel ✅ COMPLETED

**Goal:** Build comprehensive details panel with metadata display

**Status:** ✅ **COMPLETED** - Full details panel implementation

**Completed Tasks:**

1. ✅ Implemented DetailsColumn layout (lines 329-423)
    - Widget icon (64px, line 337)
    - Widget name (heading, line 339)
    - Author (subheading, lines 342-347)
2. ✅ Added Description section (lines 353-359)
    - Full description text display
    - Scrollable container
3. ✅ Added Required Providers section (lines 362-383)
    - Section heading
    - Provider list with type and required indicator
    - Credential schema details display
4. ✅ Added Configuration Options section (lines 386-409)
    - Section heading
    - Config field labels, types, and default values
5. ✅ Added "Add to Dashboard" button (lines 442-450)
    - Position at bottom of modal
    - Disabled when no widget selected
    - Enabled when widget selected
6. ✅ Wired up button click handler (lines 154-159)
7. ✅ Tested with various widget types

**Deliverables:**

-   ✅ Complete DetailsColumn component
-   ✅ "Add to Dashboard" button integration
-   ✅ Widget metadata rendering (icon, name, author, providers, config)

---

### Phase 4: Polish & Registry Stub ✅ COMPLETED

**Goal:** Add final polish, accessibility, and registry stub

**Status:** ✅ **COMPLETED** - Registry stub and polish features implemented

**Completed Tasks:**

1. ✅ Implemented registry stub (lines 73-77)
    - `selectedSource === "Discover"` returns empty array
    - Console log: "Registry: Coming soon"
2. ✅ Added registry empty state (lines 266-280)
    - "Marketplace coming soon!"
    - "Check back later for community-contributed widgets."
3. ✅ Smooth transitions with CSS classes
4. ✅ Theme-aware styling throughout
5. ✅ Widget count indicator (lines 316-325)
6. ✅ Empty states for no results

**Deliverables:**

-   ✅ Registry stub integration
-   ✅ Empty state handling
-   ✅ Visual polish and styling

---

### Phase 5: Configure Before Add 📋 PLANNED (Phase 2 Enhancements)

**Goal:** Transform from selection interface to complete "configure and add" workflow

**Status:** Superseded (2026-10-22). Milestones 2–4 were built in `EnhancedWidgetDropdown` (see Phase 2 Enhancements › Status Update); in the dashboard editor they were replaced by the edit panel (create-entry CRE-006, CRE-015).

**Planned Tasks:**

#### Milestone 1: Layout Simplification (Week 1)

1. Move Source selector from left column to filter bar
    - Add Source dropdown to filter bar (rightmost position)
    - Options: "Installed" (default), "Discover"
    - Remove left SourceColumn component
2. Restructure to 2-column layout
    - Widget List: 50% width (update from current ~33%)
    - Configure & Add Panel: 50% width (update from current ~42%)
    - Remove left column entirely
3. Implement responsive design
    - Add left descriptive area (1/3 width) on large screens (≥1024px)
    - Use `hidden lg:flex` for left area visibility
    - Adjust widget navigation width: `w-full lg:w-2/3`
    - Ensure smooth CSS transitions
4. Implement widget list ordering and prioritization
    - Sort widget list to show Installed widgets first, then Discover widgets
    - Apply alphabetical sorting within each source group
    - Add optional visual separator between source groups (divider or section heading)

#### Milestone 2: Provider Configuration (Week 2-3)

1. Add provider selection dropdowns to details panel
    - For each required provider:
        - Add dropdown select component
        - Populate with existing providers of matching type
        - Add "+ Create New {type}" option
    - State management: `selectedProviders` object
    - Validation: Check required providers before adding
2. Implement inline provider creation
    - Import ProviderForm component
    - Show form when "+ Create New" selected
    - Handle form submission:
        - Call `dashApi.saveProvider(providerData)`
        - Update AppContext.providers
        - Auto-select newly created provider
    - Close form on save/cancel
3. Add provider validation
    - Validate required providers selected
    - Show error messages for missing providers
    - Disable "Add to Dashboard" if validation fails
    - Visual indicators (red border, error text)

#### Milestone 3: User Configuration (Week 3-4)

1. Add userConfig fields section to details panel
    - Section heading: "CONFIGURATION"
    - For each userConfig field:
        - Render appropriate input component (text, number, select, boolean)
        - Show label (displayName or key)
        - Show required indicator (\*) if required
        - Display instructions if provided
    - State management: `userConfigValues` object
2. Implement field validation
    - Validate required fields filled
    - Validate field types (number, etc.)
    - Show error messages
    - Disable "Add to Dashboard" if validation fails
3. Update handleAddWidget function
    - Add provider validation
    - Add userConfig validation
    - Pass selectedProviders and userConfigValues to parent
    - Save to recent widgets

#### Milestone 4: Recent Widgets (Week 4-5)

1. Implement localStorage storage
    - Save recently added widgets with configuration
    - Store: widgetKey, timestamp, providers, userConfig
    - Max 10 items, newest first
    - Deduplicate by widgetKey
2. Add Recent Widgets section to widget list
    - Section heading: "RECENT WIDGETS"
    - Display last 3-5 recent widgets
    - Visual indicator: Clock icon (🕒)
    - Separate from main list with divider
3. Implement recent widget click handler
    - Auto-populate selectedProviders
    - Auto-populate userConfigValues
    - Display in details panel with pre-filled fields
4. Test recent widgets workflow
    - Add widget with configuration
    - Verify saved to localStorage
    - Click recent widget → verify auto-population
    - Modify and re-add

#### Milestone 5: Testing & Polish (Week 5-6)

1. Integration testing
    - Test provider creation flow end-to-end
    - Test userConfig validation
    - Test recent widgets persistence
    - Test responsive layout transitions
2. Accessibility improvements
    - ARIA labels for new form elements
    - Keyboard navigation for provider dropdowns
    - Focus management for inline forms
    - Screen reader announcements for validation errors
3. Performance optimization
    - Memoize filter functions (if not already)
    - Optimize recent widgets loading
    - Profile render performance with providers and config
4. User testing
    - Test "configure before add" workflow
    - Measure time to add configured widget
    - Gather feedback on provider creation UX
    - Iterate on validation messaging

**Success Criteria:**

-   ✅ Source selector moved to filter bar
-   ✅ 2-column layout with responsive left area
-   ✅ Provider dropdowns appear in details panel
-   ✅ Provider creation works inline
-   ✅ userConfig fields render correctly for all types
-   ✅ Validation prevents adding incomplete widgets
-   ✅ Recent widgets save and load correctly
-   ✅ Recent widget click auto-populates configuration
-   ✅ Widget added with providers and config in single action
-   ✅ Time to add configured widget <15 seconds
-   ✅ Time to re-add recent widget <3 seconds

**Deliverables:**

-   Updated EnhancedWidgetDropdown component with:
    -   2-column responsive layout
    -   Provider selection and creation
    -   userConfig field rendering
    -   Recent widgets feature
    -   Complete validation
-   Integration with existing ProviderForm component
-   localStorage recent widgets tracking
-   Updated parent component integration (LayoutBuilder)

---

### Phase 6: Registry Integration (Future)

**Goal:** Connect to real marketplace API for widget discovery and installation

**Status:** 🔮 **FUTURE** - Out of scope for current PRD

**Planned Features:**

-   Real marketplace API integration
-   Widget installation workflow
-   Version management and updates
-   Widget ratings and reviews

---

### Phase 7: Enhanced Metadata (Future)

**Goal:** Enrich widget model with additional metadata fields

**Status:** 🔮 **FUTURE** - Requires widget model updates

**Planned Features:**

-   Add author field to widget model
-   Add version field to widget model
-   Add screenshots/previews
-   Add repository URL and documentation links

---

### Phase 8: Advanced Features (Future)

**Goal:** Add advanced UX and filtering capabilities

**Status:** 🔮 **FUTURE** - Post-Phase 2 enhancements

**Planned Features:**

-   Widget categories/tags
-   Advanced sorting options (by popularity, last updated, etc.)
-   Mobile responsive view (<1000px)
-   Multi-select filters
-   Widget preview before adding (live rendering)

---

## Technical Documentation Links

**Related Components:**

-   Current WidgetDropdown: `./src/Components/Layout/Builder/Enhanced/WidgetDropdown.js`
-   ComponentManager: `./src/ComponentManager.js`
-   Widget Model: `./src/Models/ComponentConfigModel.js`

**dash-react Components (to be used):**

-   Modal: `@trops/dash-react/Common/Modal`
-   Panel: `@trops/dash-react/Common/Panel`
-   Button: `@trops/dash-react/Common/Button`
-   InputText: `@trops/dash-react/Common/Input/InputText`
-   SelectMenu: `@trops/dash-react/Common/Input/SelectMenu`

**External Documentation:**

-   TailwindCSS Grid: https://tailwindcss.com/docs/grid-template-columns
-   React Hooks: https://react.dev/reference/react
-   WCAG 2.1 Accessibility: https://www.w3.org/WAI/WCAG21/quickref/

---

## Revision History

| Version | Date       | Author       | Changes                                                                                                                                                  |
| ------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | 2026-02-14 | Product Team | Initial PRD creation (Phase 1: Three-column layout, filtering, widget details)                                                                           |
| 2.0.0   | 2026-02-14 | Product Team | Added Phase 2 requirements: Configure before add workflow, provider configuration, userConfig fields, recent widgets, 2-column layout, responsive design |
| 2.1.0   | 2026-10-22 | Product Team | Consolidation Phase 5: Phase 2 status (US-P2-001–003 built in the pop-up); superseded in the dashboard editor by the edit panel's Add tab and the one widget panel |

---

## Appendix

### Widget Data Model Reference

```javascript
{
  // Core Metadata
  key: string,               // Unique widget identifier (e.g., "analytics-widget")
  name: string,              // Display name (e.g., "Analytics Dashboard")
  type: "widget",            // Component type (always "widget")
  workspace: string,         // Workspace namespace
  author: string,            // Author or organization name (optional, used for filtering)
  description: string,       // Optional description
  icon: string,              // Unicode emoji icon (e.g., "📊")

  // Provider Requirements
  providers: [               // Array of required providers
    {
      type: string,          // Provider type (e.g., "slack", "algolia")
      required: boolean,     // Is provider required or optional?
      credentialSchema: {    // Credential requirements
        // Provider-specific fields
        // e.g., { oauthToken: "string", workspaceUrl: "string" }
      }
    }
  ],

  // Configuration
  userConfig: {              // User-editable configuration fields
    // Field definitions
    // e.g., { title: { type: "text", default: "My Widget" } }
  },

  // Styling and Behavior
  styles: {},                // Widget-specific styles
  events: [],                // Widget events
  eventHandlers: [],         // Event handler definitions
  canHaveChildren: boolean,  // Can widget contain child widgets?
}
```

### Filter Logic Pseudocode

```javascript
function filterWidgets(widgets, searchQuery, authorFilter, providerFilter) {
    return widgets.filter((widget) => {
        // Search filter (OR across fields)
        const matchesSearch =
            searchQuery === "" ||
            widget.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            widget.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (widget.description &&
                widget.description
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()));

        // Author filter
        const matchesAuthor =
            authorFilter === "All Authors" || widget.workspace === authorFilter;

        // Provider filter
        let matchesProvider = true;
        if (providerFilter === "None") {
            matchesProvider = widget.providers.length === 0;
        } else if (providerFilter !== "All Providers") {
            matchesProvider = widget.providers.some(
                (p) => p.type === providerFilter
            );
        }

        // AND logic
        return matchesSearch && matchesAuthor && matchesProvider;
    });
}
```

### Success Metrics Tracking

**Metrics to Track:**

1. **Time to add widget:** Timestamp modal open → timestamp widget added
2. **Filter usage rate:** % of sessions using each filter type
3. **Search usage rate:** % of sessions using search
4. **Details panel engagement:** % of sessions viewing details before adding
5. **Keyboard navigation usage:** % of sessions using keyboard shortcuts

**Analytics Events:**

-   `widget_dropdown_opened`
-   `widget_search_used` (with query length)
-   `widget_filter_used` (with filter type: author/provider)
-   `widget_selected` (with widget key)
-   `widget_details_viewed` (with widget key)
-   `widget_added` (with widget key, time_to_add_ms)
-   `widget_dropdown_closed` (with outcome: added/cancelled)

---

**End of PRD**

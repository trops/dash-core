# Scoped Widget IDs — Canonical Identity Across the App

**Status:** Implemented (v0.1.435 — strict resolution + origin-stamping; v0.1.436 — listener migration + per-widget panel fix)

## Executive Summary

Every publishable thing in dash — widgets, themes, dashboards — has
exactly one canonical identity: a scoped, dotted id of the form
`<scope>.<package>.<Component>` (widgets) or `<scope>.<name>` (themes
and dashboards in subsequent rollouts). The id is the only key the
runtime uses to resolve a layout item to a registered React
component. There is no fallback chain, no bare-name suffix scan at
render time, no `packageId` hint plumbing through every consumer.

This is a follow-on to two earlier rounds of churn (the v0.1.432
scoped-IDs migration + the v0.1.433–434 fallback work). The original
fallback work papered over the gaps in registration + persistence;
this PRD locks the contract end-to-end so future surfaces inherit it
by default.

## Problem Statement

Pre-v0.1.435 the runtime had three identity systems running in
parallel:

1. The widget `.dash.js` config carried a *suggested* id via either
   `config.id`, `config.scope + config.packageName`, or implicit
   filename conventions.
2. `ComponentManager.componentMap()` was keyed by *whatever the
   caller passed* to `registerWidget` — sometimes the bare name,
   sometimes a scoped id, sometimes a `widgetKey` string from the
   bundle loader. Two packages shipping the same component name
   silently collided.
3. Layout items and listener event strings stored the bare name,
   even though the runtime publisher emitted under the scoped form
   after a workspace was opened.

Consequences:

- Three different widgets in three different layout cells could
  render the same React component because the resolver suffix-scan
  picked the wrong scoped key. (User-reported: "EventSender,
  EventReceiver, NotificationWidget all show the DashboardApiTester
  body.")
- Per-widget listener UI saved listener strings using a bare
  component name; the publisher emitted under the scoped name; the
  subscription never matched; listeners stopped firing.
- `pruneDeadListenerReferences` walked the workspace post-migration,
  saw bare listener strings vs. scoped live items, treated every
  legacy binding as an orphan, and silently destroyed the user's
  wiring on first save.
- Display surfaces (`WidgetCardHeader`, `LayoutBuilderConfigModal`,
  `DashboardConfigModal.Dependencies`) fell through to
  `item.workspace` as a "package id" and showed nonsense labels
  (`@DashSamples-workspace`).

## The Contract

### Identity format

| Type | Format | Example |
| --- | --- | --- |
| Widget | `<scope>.<package>.<Component>` | `trops.pipeline.PipelineKanban` |
| Theme | `<scope>.<name>` | `trops.solarized` |
| Dashboard | `<scope>.<name>` | `trops.pipeline-overview` |

### Reserved scopes

| Scope | Meaning | Source |
| --- | --- | --- |
| `local` | Lives only on this developer's machine | `dash-electron/src/Widgets/<Pkg>/` |
| `ai-built` | AI Widget Builder output (pre-publish) | `~/.dash/cache/@ai-built/` |
| `<username>` | Published to the registry under this user | npm publish + dash-registry upload |

Publish-time scope remap (`remapLayoutPackageScopes`) rewrites
`@ai-built/...` → `@<callerScope>/...` so a widget developed locally
ships under the publisher's identity. `assertNoLocalScopes` is the
defense-in-depth guard that throws if any `@ai-built/*` reference
survives the remap.

## Where the contract is enforced

### Registration choke point

`ComponentManager.registerWidget` calls `canonicalScopedId(config,
widgetKey)`. The function returns:

1. `config.id` if it's already 3 dot-separated parts;
2. derived from `config.scope + config.packageName + config.name`;
3. `widgetKey` if *it* is already 3 dot-separated parts;
4. otherwise throws.

No widget enters the registry without a canonical id. Tests in
`ComponentManager.test.js` pin every branch.

### Lookup choke point

`resolveComponentKey(map, component)` is one line: exact match or
null. The `data` parameter and the `packageId` hint are gone. Tests
in `resolveComponentKey.test.js` pin strict behavior.

### Persistence migration

`migrateScopedIdsInWorkspace(workspace, componentMap)` runs in
`WorkspaceModel` BEFORE `pruneDeadListenerReferences`. It:

- Walks layout, pages, sidebar, and nested `items`/`layout` arrays.
- Migrates each `item.component` from bare → scoped (suffix scan, or
  no-op if no unambiguous match exists).
- Walks every `item.listeners[handler]` array; for each `Comp[id].evt`
  string, migrates the `Comp` portion using the same suffix scan.
- Idempotent — calling twice produces the same result as calling once.
- Tests in `migrateScopedIdsInWorkspace.test.js`.

`migrateBareComponentName` is the underlying suffix-scan utility and
the ONLY suffix-scan call site in the runtime. It refuses to guess
when multiple registry entries match the same bare name.

### Display

`WidgetCardHeader`, `LayoutBuilderConfigModal`, and
`DashboardConfigModal.Dependencies` derive the `@<scope>/<package>`
label directly from `item.component.split(".")`. The `item.workspace`
fallback is gone. Tests pinning the strict derivation live next to
each component.

### Drag → layout

`WidgetSidebar.DraggableWidgetItem` puts the scoped registry key in
the drag payload (`widgetKey`). `LayoutBuilder.handleDropWidgetFromSidebar`
writes that scoped id into the new layout item's `component` field.
Going forward every freshly-created layout item is born scoped.

## Audit checklist (re-run before any cross-cutting change)

When touching anything in the layout / lookup / event pipeline,
verify each of these still holds:

- [ ] `resolveComponentKey` is one line. No fallback. No second arg.
- [ ] `registerWidget` throws on missing origin metadata.
- [ ] `LayoutModel` does NOT do the bare-name migration —
      `WorkspaceModel` does it once at workspace load.
- [ ] `migrateScopedIdsInWorkspace` runs BEFORE
      `pruneDeadListenerReferences`. Order matters: prune-first
      destroys legacy wiring.
- [ ] No `${item.workspace}` or similar fallback in any package-label
      derivation. The label is always
      `item.component.split(".").slice(0, 2).join("/")` formatted
      as `@<scope>/<package>`.
- [ ] Drag/drop and click-add handlers write
      `component: <scoped-id>` into the new layout item, never the
      bare display name.
- [ ] Per-widget listener editor uses `forEachWidget` for source
      widget enumeration. Direct walks over
      `workspace.layout + pages[].layout` will double-count when
      `pages[0].layout === workspace.layout` (the
      single-page-no-explicit-pages shape WorkspaceModel sets up).
- [ ] Per-widget listener editor uses `applyWiringChanges` to
      persist. Direct `replaceItemInLayout(workspace.layout, ...)`
      silently fails when the receiver is in a page or the sidebar.
- [ ] Publish-time `assertNoLocalScopes` still runs. Widgets / themes
      / dashboards must NEVER ship to the registry with `local.*` or
      `ai-built.*` ids.

## Known gaps (follow-up)

- **`WidgetFactory dash:widget-installed` matcher** does direct
  string equality between the broadcast `widgetName` (bare) and the
  layout item's `component` (scoped). Won't re-mount on package
  update. Low-severity — manual reload works around it. Fix in a
  separate PR with a test that covers the matcher logic.
- **Themes and dashboards** still use ad-hoc identifiers. The
  v0.1.436 PR ships widgets only; themes follow in 0.1.437,
  dashboards in 0.1.438. Each rollout brings its own
  `migrate*InWorkspace`-style pre-pass, registration choke point,
  and audit checklist update.

## Lessons (internal, for future-me)

- Strict-mode + migration is cheaper than fallback chains. Fallbacks
  hide bugs; migration surfaces them at a single, observable point.
- Per-item migration in `LayoutModel` can't see cross-references.
  Listener strings reference OTHER items by component name —
  workspace-level migration is the only place where that's tractable.
- When a refactor adds a new identity, audit every consumer of the
  *old* identity in one pass. Skipping consumers and adding fallbacks
  for them later is what produced this whole sequence.

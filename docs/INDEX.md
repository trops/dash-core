# @trops/dash-core Documentation

## Overview

`@trops/dash-core` is the core framework for Dash dashboard applications. It provides the widget system, provider architecture, context providers, layout engine, and Electron main process layer.

For project setup and quick start, see the [README](../README.md).

---

## Widget System

| Document | Description |
|---|---|
| [Widget System](WIDGET_SYSTEM.md) | Architecture overview, auto-registration, hot reload, ComponentManager |
| [Widget API](WIDGET_API.md) | Management API reference — install, uninstall, list, events |
| [Widget API Quick Reference](WIDGET_API_QUICK_REF.md) | Condensed method reference for frontend developers |
| [Widget Development](WIDGET_DEVELOPMENT.md) | Step-by-step guide to creating and testing widgets |
| [Widget Registry](WIDGET_REGISTRY.md) | Packaging, distribution, and dynamic loading |

## Provider System

| Document | Description |
|---|---|
| [Provider Architecture](PROVIDER_ARCHITECTURE.md) | Three-tier storage model, encryption, MCP providers, context integration |
| [Client Cache](CLIENT_CACHE.md) | SDK client caching, factory registration, credential resolution |
| [Widget Provider Configuration](WIDGET_PROVIDER_CONFIGURATION.md) | Configuring provider requirements in `.dash.js` files |

## Testing

| Document | Description |
|---|---|
| [Testing](TESTING.md) | Provider testing workflows, manual testing steps, verification checklists |

---

## Requirements & Product Design

| Document | Description |
|---|---|
| [Requirements README](requirements/README.md) | PRD system overview, when to create PRDs, testing workflows |
| [CommandPalette Navigation](requirements/prd/command-palette-navigation.md) | Navbar, Cmd+K palette, tab bar, EmptyState — Phase 1 + 1.1 Complete |
| [LayoutBuilder Hybrid](requirements/prd/layout-builder-hybrid.md) | Notion-style inline widget addition — Phase 1 Complete |
| [Dashboard Marketplace](requirements/prd/dashboard-marketplace.md) | Browse, install, share dashboard configurations — Implemented |
| [MCP Providers](requirements/prd/mcp-providers.md) | MCP server provider system — Phase 1-3 Complete |
| [Widget Installation Model](requirements/prd/widget-installation-model.md) | Registry-first widget model — Implemented |
| [Widget Dropdown](requirements/prd/widget-dropdown.md) | Enhanced Mac Finder-style widget selector — Phase 1 Complete |
| [Widget Display & Installation UX](requirements/prd/widget-display-and-installation.md) | Widget identity, progress, auth, batch resolution — Partially Implemented |

---

## Related Documentation

- **dash-electron** (app template): Setup, development workflow — see the [dash-electron docs](https://github.com/trops/dash-electron)
- **@trops/dash-react** (UI components): Component reference, theme system — see the [dash-react docs](https://github.com/trops/dash-react)

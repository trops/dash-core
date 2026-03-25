# Product Requirements Documentation

## Overview

This directory contains Product Requirements Documents (PRDs) for dash-core framework features. PRDs complement the existing technical documentation by providing business context, user needs, and success criteria.

**What PRDs Answer:**

-   **Why** are we building this feature? (Problem statement, business value)
-   **Who** is it for? (User personas, pain points)
-   **What** defines success? (Acceptance criteria, metrics)
-   **When** should it be done? (Implementation phases, priorities)

**What Technical Docs Answer:**

-   **How** is it built? (Architecture, design patterns)
-   **Where** is the code? (File locations, code structure)
-   **What** are the APIs? (Function signatures, parameters)

## Documentation Hierarchy

```
PRDs (requirements)
  | Define user needs and acceptance criteria
Architecture Docs (design)
  | Define system structure and patterns
Implementation Guides (code)
  | Provide code examples and integration steps
```

---

## Existing PRDs

| PRD | Status | Summary |
|-----|--------|---------|
| [Command Palette Navigation](./prd/command-palette-navigation.md) | Phase 1 + 1.1 Complete | Keyboard-driven quick navigation across widgets, workspaces, and settings |
| [Layout Builder Hybrid](./prd/layout-builder-hybrid.md) | Phase 1 Complete | Hybrid drag-and-drop + command-driven layout editing |
| [Dashboard Marketplace](./prd/dashboard-marketplace.md) | Implemented | Browse, discover, and install widgets from a central registry |
| [MCP Providers](./prd/mcp-providers.md) | Phase 1-3 Complete, Phase 4 In Progress | MCP-based provider system for widget-to-tool connectivity |
| [Widget Installation Model](./prd/widget-installation-model.md) | Implemented | Core widget install/uninstall lifecycle and persistence |
| [Widget Dropdown](./prd/widget-dropdown.md) | Phase 1 Complete, Phase 2 Planned | Mac Finder-style widget picker with search and categories |
| [Widget Display & Installation](./prd/widget-display-and-installation.md) | Partially Implemented | End-to-end UX for browsing, previewing, and installing widgets |

---

## When to Create a PRD

Create a new PRD when:

-   **Starting a new framework feature** -- widget system changes, new provider types, layout engine updates, MCP extensions
-   **Significant user-facing changes** -- new UI paradigms, workflow redesigns, navigation overhauls
-   **Cross-cutting concerns** -- security model changes, theme system redesign, settings architecture
-   **Stakeholder alignment required** -- multiple consumers (dash-electron, external widget authors) affected
-   **Need to define success metrics** before technical work begins

Skip a PRD for bug fixes, API signature tweaks, performance optimizations, or documentation updates. Update existing technical docs instead.

---

## Creating a New PRD

### Using the prdize Script (Recommended)

```bash
node scripts/prdize.js "Feature Name"

# Dry run (preview without creating files)
node scripts/prdize.js "Feature Name" --dry-run
```

The script will:

1. Create `docs/requirements/prd/feature-name.md` from template
2. Replace placeholders with feature name and current date
3. Update this README with a new PRD entry

### Manual Creation

1. Copy [PRD-TEMPLATE.md](./PRD-TEMPLATE.md)
2. Rename to `prd/your-feature-name.md`
3. Replace all `[Feature Name]` placeholders
4. Update dates (`YYYY-MM-DD`)
5. Add entry to the "Existing PRDs" table above

---

## Testing PRDs

### Generate Test Checklist

```bash
# View all acceptance criteria for a PRD
npm run test:prd layout-builder-hybrid

# View checklist with verification steps
npm run test:prd layout-builder-hybrid --checklist
```

### Check Test Coverage

```bash
# See which acceptance criteria have automated tests
npm run prd:coverage layout-builder-hybrid
```

### Testing Workflow

**During Implementation:**

1. Read the PRD user story
2. Run `npm run test:prd [prd-name] --checklist`
3. Implement the feature
4. Write tests for each acceptance criterion
5. Run `npm run prd:coverage [prd-name]`

**During PR Review:**

1. Verify PR links to a specific user story
2. Check Definition of Done checklist is complete
3. Run automated tests
4. Manually verify ACs that cannot be automated
5. Check PRD coverage report

**Post-Merge:**

1. Update PRD user story status to "Completed"
2. Check off acceptance criteria in PRD
3. Run full coverage report

---

## User Stories Format

Stories are embedded in each PRD using priority tiers (P0 Must-Have, P1 Should-Have, P2 Nice-to-Have). Each story includes acceptance criteria, edge cases, technical notes, and a definition of done. See [PRD-TEMPLATE.md](./PRD-TEMPLATE.md) for the full format.

---

## PRD Lifecycle

1. **Draft** -- Initial creation, collecting requirements
2. **In Progress** -- Implementation ongoing, phases tracked
3. **Completed** -- Feature shipped, PRD serves as historical reference
4. **Deprecated** -- Feature removed or replaced; archive to `prd/archive/`

**Keeping PRDs Current:**

-   Update "Last Updated" date when making changes
-   Add to "Revision History" for major changes
-   Link new user stories to related technical docs
-   Update success metrics if goals change
-   When all phases are complete, set status to "Completed"

---

## Integration with Technical Documentation

### PRDs Link TO Technical Docs

```markdown
**Technical Notes:** See [PROVIDER_ARCHITECTURE.md](../PROVIDER_ARCHITECTURE.md) for implementation details.
```

### Technical Docs Link FROM PRDs

```markdown
This architecture implements requirements from [PRD: MCP Providers](../requirements/prd/mcp-providers.md).
```

### One Source of Truth Rule

-   If information exists in a technical doc, the PRD **links** to it
-   PRDs focus on **WHY** and **WHO**
-   Technical docs focus on **HOW**
-   No duplication of content

---

## Related Documentation

**Technical Documentation:**

-   [INDEX.md](../INDEX.md) -- Documentation index
-   [WIDGET_SYSTEM.md](../WIDGET_SYSTEM.md) -- Widget architecture and ComponentManager
-   [WIDGET_API.md](../WIDGET_API.md) -- Widget management API reference
-   [PROVIDER_ARCHITECTURE.md](../PROVIDER_ARCHITECTURE.md) -- Provider system design and MCP integration
-   [WIDGET_DEVELOPMENT.md](../WIDGET_DEVELOPMENT.md) -- Widget development guide
-   [TESTING.md](../TESTING.md) -- Testing workflows and verification checklists

**Project Context:**

-   [CLAUDE.md](../../CLAUDE.md) -- AI assistant workflow and development protocols
-   [PRD-TEMPLATE.md](./PRD-TEMPLATE.md) -- Full PRD template for new features

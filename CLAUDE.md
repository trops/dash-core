# @trops/dash-core — Core Dashboard Framework

> ⚠️ **THIS FILE IS A PROTOCOL, NOT DOCUMENTATION.**
> Every section marked MANDATORY must be followed in order, without exception.
> If anything is unclear — requirements, file locations, which repo to change —
> **ASK before proceeding. Do not infer. Do not improvise.**

---

## ⚠️ MANDATORY: Before Any Code Changes

These steps are NON-NEGOTIABLE and must happen in this exact order before writing any code:

1. Sync dash-core (this repo):
   ```bash
   git checkout master && git pull origin master
   ```

2. Locate and sync sibling repos. They live alongside this repo — discover their paths:
   ```bash
   REPO_ROOT="$(git rev-parse --show-toplevel)"
   DASH_REACT="$(find "$(dirname "$REPO_ROOT")" -maxdepth 3 -name "package.json" | xargs grep -l '"name": "@trops/dash-react"' 2>/dev/null | head -1 | xargs dirname)"
   DASH_ELECTRON="$(find "$(dirname "$REPO_ROOT")" -maxdepth 3 -name "package.json" | xargs grep -l '"name": "dash-electron"' 2>/dev/null | head -1 | xargs dirname)"
   echo "dash-react:    $DASH_REACT"
   echo "dash-electron: $DASH_ELECTRON"
   ```
   If either is not found, **STOP and ask the user where the repo is cloned.** Do not assume a path.

3. Pull latest in each found sibling repo:
   ```bash
   cd "$DASH_REACT" && git pull origin master
   cd "$DASH_ELECTRON" && git pull origin master
   ```

4. Return to this repo and create a feature branch:
   ```bash
   cd "$REPO_ROOT"
   git checkout -b feat/<TICKET-KEY>-<slug>
   ```

**If any pull fails: STOP. Report the exact error. Do not proceed.**

---

## ⚠️ MANDATORY: PRD Gate

Before writing any code for a feature:

1. Run:
    ```bash
    ls docs/requirements/prd/
    ```
2. If a relevant PRD exists, read it fully before proceeding.
3. Confirm to the user: "Read PRD: `<filename>`" or "No relevant PRD found."
4. Do not start implementation until this confirmation is given.

---

## ⚠️ MANDATORY: PRD Management

When implementing a new feature or significant enhancement:

1. **Check for existing PRD:** Check `docs/requirements/prd/` in this repo.
2. **If a PRD exists:** Read it fully. Update its status, acceptance criteria, and implementation
   notes to reflect the current work. Do not create a duplicate.
3. **If no PRD exists:** Create one using `node scripts/prdize.js "Feature Name"` (or manually
   from the template at `docs/requirements/PRD-TEMPLATE.md`). At minimum, fill in: Executive Summary,
   Problem Statement, and User Stories with acceptance criteria.
4. **After implementation:** Update the PRD with implementation notes, lessons learned,
   and correct status (Draft → In Progress → Implemented).

Bug fixes and single-file changes do not require a PRD.
Cross-repo features: the PRD lives in the repo that owns the primary implementation.

---

## ⚠️ MANDATORY: Development Phases

These four phases are sequential and cannot be skipped, combined, or reordered.

### Phase 1 — PLAN

1. State the task in one sentence.
2. List every file that will be created or modified.
3. List any dependencies that will be added.
4. Identify risks, ambiguities, or cross-repo implications.
5. Explicitly state whether this change has downstream effects on dash-electron or dash-react.
6. **Wait for explicit user approval before writing a single line of code.**
   Acceptable approvals: "proceed", "looks good", "go ahead", 👍.
   Silence is NOT approval.

### Phase 2 — IMPLEMENT

1. Make only the changes listed in the approved plan.
2. Do not refactor, rename, or "improve" anything outside the plan.
3. Do not add dependencies not listed in the plan.
4. **Use `@trops/dash-react` components for all UI.** See UI Component Rule below.
5. Run Prettier when done:
   ```bash
   npm run prettify
   ```
6. Fix any Prettier errors before proceeding.
7. Stage any new (untracked) files created in this phase before proceeding to Phase 3:
   ```bash
   git add <each new file explicitly by path>
   ```
   The CI script uses `git add -u` which only stages tracked files — any new file not
   staged here will be silently excluded from the commit. Do not use `git add .` or `git add -A`.

### Phase 3 — VALIDATE

1. Run the full CI validation:
   ```bash
   npm run ci
   ```
2. If it fails, fix the errors and re-run. Do not proceed with a failing build.
3. Do not mark this phase complete until `npm run ci` exits cleanly.
4. Verify all three dist output files exist:
   ```bash
   ls dist/index.js dist/index.esm.js dist/electron/index.js
   ```
   If any file is missing, the build silently failed — treat this as a CI failure.
5. **If you cannot make CI pass: STOP. Report the exact output. Do not proceed.**

### Phase 4 — RELEASE

1. Use the CI script — **this is the only approved release path**:
   ```bash
   npm run ci:release -- -m "type(scope): description"
   ```
2. Do not manually construct `git commit`, `git push`, `git tag`, or `gh pr` commands.
   Manual git commands outside of `ci.sh` are not permitted.
3. Confirm to the user: "Released. Commit: `<hash>` pushed to `<branch>`."

---

## ⚠️ MANDATORY: Cross-Repo Changes

dash-core is a dependency of dash-electron (and peer of dash-react). Changes here have
downstream consequences. The mandatory order is:

1. Sync ALL repos first (see Mandatory Pre-Work above — sibling repos are discovered, not assumed).
2. Make and validate changes in dash-core **first**.
3. Run `npm run ci` in dash-core and confirm it passes — including dist output verification.
4. If the change affects dash-react, apply and validate those changes next.
5. Only then update dash-electron to consume the new version.
6. Run `npm run ci` in dash-electron to confirm end-to-end compatibility before releasing anything.
7. Never modify dash-electron to work around a missing dash-core change — fix it at the source.
8. Read `.claude/skills/cross-repo-dev/SKILL.md` before starting any cross-repo task.

**Never release dash-core without verifying dash-electron still builds and runs against it.**

---

## ⚠️ UI Component Rule — Use @trops/dash-react for All UI

`@trops/dash-react` is the UX library for the entire Dash ecosystem. All UI components
in dash-core must come from `@trops/dash-react` to maintain visual and behavioral
consistency across the application.

```javascript
// CORRECT — always import UI components from @trops/dash-react
import {
    Panel, Panel2, Panel3,
    Heading, SubHeading,
    Button, ButtonIcon,
    Widget, Workspace,
    Modal, Notification,
    LayoutContainer,
    ErrorBoundary,
    FontAwesomeIcon,
    ThemeContext,
} from "@trops/dash-react";

// WRONG — never build custom UI components that duplicate dash-react functionality
// WRONG — never import ThemeContext from a local file
import { ThemeContext } from "./Context/ThemeContext"; // creates dual context instances

// WRONG — never import FontAwesomeIcon directly
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"; // duplicates dependency
```

**Before building any new UI component, check whether @trops/dash-react already provides it.**
If dash-react is missing something that dash-core needs, the correct fix is to add it to
dash-react first (cross-repo task), not to build a local substitute in dash-core.

---

## ⚠️ NON-NEGOTIABLE RULES

- **Never skip a phase.** Even if the task "seems simple."
- **Never combine phases.** Do not implement and validate in the same step.
- **Never push directly to master.** Always use feature branches and PRs via `ci:release`.
- **Never use `git push --force` or `git reset --hard`.**
- **Never use `git add .` or `git add -A`.** Stage only the files changed in Phase 2.
- **Never build custom UI components that duplicate @trops/dash-react.** Use dash-react.
- **Never release dash-core without verifying dash-electron compatibility.**
- **When in doubt, ask.** Do not infer requirements. Do not improvise solutions.
- **If a command fails, stop.** Report the exact error output. Do not attempt workarounds.

---

## ci.sh — The Only Approved Release Path

The `scripts/ci.sh` script handles the full pipeline: Node 20 via nvm, Prettier, renderer
build, electron build + MCP catalog, Jest tests, MCP tests, output verification, commit,
version bump, push, PR, merge, tag, and cleanup.

```bash
# Validate only
npm run ci

# Validate + commit + version bump
npm run ci:commit -- -m "Your commit message"

# Above + push branch
npm run ci:push -- -m "Your commit message"

# Above + create PR
npm run ci:pr -- -m "Your commit message"

# Above + merge PR + tag + cleanup
npm run ci:release -- -m "Your commit message"
```

Each flag is cumulative. `--release` runs all prior steps automatically.

### ⚠️ After `ci:release` succeeds — HANDS OFF

The npm publish to `@trops/dash-core` is handled by the **GitHub Actions
workflow** (`release-package.yml`) on push to master. Claude's job ends at
`ci:release` completing locally.

After `ci:release` reports success:

- ✅ Verify the publish landed with `npm view @trops/dash-core version`. That's it.
- ❌ **Do NOT** `gh run rerun` a failed publish workflow. The workflow runs once on
  push; re-running is the user's call, not Claude's.
- ❌ **Do NOT** attempt or suggest a manual `npm publish` from the local checkout.
  Manual publishes are outside the protocol — they bypass the signed-provenance
  flow and the org's secret management.
- ❌ **Do NOT** offer "debugging steps" like `NODE_AUTH_TOKEN=... npm publish`.
  If the GitHub Action fails, surface the exact error and stop. The npm
  registry / GitHub secrets are the user's domain, not Claude's.

If the publish workflow fails, report:
1. The workflow run URL (from `gh run list`)
2. The exact error from `gh run view <id> --log-failed`
3. Then stop. Wait for the user to fix the workflow / secret / npm state.

**During development only**, individual build targets may be used to iterate faster:

```bash
npm run build:renderer   # Renderer layer only (ESM + CJS)
npm run build:electron   # Electron layer only (CJS)
```

These are NOT substitutes for `npm run ci` — always run the full pipeline before release.

---

### Visual Inspection (cross-repo)

When changes affect rendered UI, validate visually in dash-electron after linking:

```bash
# In dash-electron (after npm run link-core)
npm run screenshot -- --click-selector 'button:has([data-icon="circle-user"], [data-icon="user"])' --click "Settings" --click "Themes"
```

The plan's verification section MUST include the screenshot command with navigation flags appropriate to the feature being changed. See dash-electron CLAUDE.md for the full navigation map and all options.

## Code Style

- **Formatting:** Prettier (`.prettierrc`), 4-space indentation
- **Components:** PascalCase (`MyWidget.js`)
- **Widget configs:** `{ComponentName}.dash.js`
- **Utilities:** camelCase (`layout.js`)
- **Contexts:** PascalCase with suffix (`ThemeContext.js`)
- **Electron layer:** CommonJS (`require` / `module.exports`)
- **Renderer layer:** ES modules (`import` / `export`)
- **UI components:** Always from `@trops/dash-react` — never built locally if dash-react provides it

---

## Reference

For architecture, directory structure, key patterns, build commands, and troubleshooting,
see [README.md](README.md) and [docs/INDEX.md](docs/INDEX.md).

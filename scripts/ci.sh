#!/bin/bash
set -euo pipefail

# ============================================================================
# Local CI Script
# Runs the full validation pipeline and optionally handles git workflow.
#
# Usage:
#   ./scripts/ci.sh                           # validate only
#   ./scripts/ci.sh --commit -m "message"     # validate + commit + bump
#   ./scripts/ci.sh --push -m "message"       # above + push
#   ./scripts/ci.sh --pr -m "message"         # above + create PR
#   ./scripts/ci.sh --release -m "message"    # above + merge + tag + cleanup
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Tools ci.sh and scripts/release.js call (gh, git, …) must be found even when
# PATH is the Mac app's bare one, as it is for Dash's bots: add Homebrew's
# folders. Node comes from nvm below.
for _dir in /opt/homebrew/bin /usr/local/bin; do
    if [[ -d "$_dir" && ":$PATH:" != *":$_dir:"* ]]; then
        PATH="$_dir:$PATH"
    fi
done
export PATH

# --- Parse arguments ---
MODE="validate"
COMMIT_MSG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --commit) MODE="commit"; shift ;;
        --push)   MODE="push";   shift ;;
        --pr)     MODE="pr";     shift ;;
        --release) MODE="release"; shift ;;
        -m)
            shift
            COMMIT_MSG="$*"
            break
            ;;
        *)
            echo "Unknown argument: $1"
            exit 1
            ;;
    esac
done

if [[ "$MODE" != "validate" && -z "$COMMIT_MSG" ]]; then
    echo "Error: -m \"message\" is required with --commit, --push, --pr, or --release"
    exit 1
fi

# --- Helper ---
step() {
    echo ""
    echo "=====> $1"
    echo ""
}

# Run a test command and fail CI if it leaves test folders/files behind
# in the OS temp dir (see scripts/checkTempLeaks.js). Tests make temp
# folders with tempDir() from electron/testUtils/tempDir.js.
no_temp_leaks() {
    if ! node scripts/checkTempLeaks.js -- "$@"; then
        echo ""
        echo "Error: tests failed or left files in the temp dir (see above)."
        exit 1
    fi
}

# ============================================================================
# VALIDATION STEPS
# ============================================================================

# 1. Ensure Node 20 via nvm (on GitHub Actions the workflow sets up Node)
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    step "Using the runner's Node (GitHub Actions)"
else
    step "Ensuring Node 20 via nvm"
    unset npm_config_prefix
    export NVM_DIR="$HOME/.nvm"
    if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
        echo "Error: nvm not found at $NVM_DIR/nvm.sh"
        exit 1
    fi
    source "$NVM_DIR/nvm.sh" --no-use
    nvm use --delete-prefix v20.20.0
fi
echo "Node version: $(node -v)"
echo "npm version: $(npm -v)"

# 1a. What was changed before validation ran (DASH-153). The release step
# commits these files and no others, so nothing a validation step rewrites
# can slip into a commit. Every tracked file changed against HEAD, staged or
# not, plus new files not yet added.
CHANGED_LIST="$(mktemp "${TMPDIR:-/tmp}/dash-ci-changed.XXXXXX")"
trap 'rm -f "$CHANGED_LIST"' EXIT
git diff --name-only --no-renames HEAD > "$CHANGED_LIST"
CHANGED_NEW="$(git ls-files --others --exclude-standard)"

# 2. Prettier (DASH-153): validation never rewrites a file you didn't change.
# On GitHub Actions and in the Code Factory's validate (.dash/checks/
# validate.sh sets DASH_CI_PRETTIER=check) it only checks. Run by hand, it
# formats just the files you changed (and new ones), then checks everything.
PRETTIER_GLOBS=("src/**/*.{js,jsx,ts,tsx}" "electron/**/*.js")
PRETTIER_FILES_RE='^(src/.*\.(js|jsx|ts|tsx)|electron/.*\.js)$'
if [[ -n "${GITHUB_ACTIONS:-}" || "${DASH_CI_PRETTIER:-}" == "check" ]]; then
    step "Checking Prettier formatting"
else
    step "Running Prettier on the files you changed"
    MINE=()
    while IFS= read -r f; do
        if [[ -n "$f" && -f "$f" && "$f" =~ $PRETTIER_FILES_RE ]]; then
            MINE+=("$f")
        fi
    done < <(cat "$CHANGED_LIST"; printf '%s\n' "$CHANGED_NEW")
    if [[ ${#MINE[@]} -gt 0 ]]; then
        npx prettier --write "${MINE[@]}"
    else
        echo "No changed files to format."
    fi
    step "Checking Prettier formatting"
fi
if ! npx prettier --check "${PRETTIER_GLOBS[@]}"; then
    echo ""
    echo "Error: the files above aren't formatted. Format the ones you changed:"
    echo "  npx prettier --write <file> ..."
    exit 1
fi

# 2a. ESLint (DASH-157): Dash's rules (eslint.config.mjs) — dash-react UI
# only, ThemeContext from dash-react, CommonJS in electron/, no require()
# in src/, no palette shades or theme keys as classes, hooks. Existing
# violations are baselined (eslint-suppressions.json, --max-warnings), so
# only new ones fail. (The rules' own tests run with the node:test files.)
step "Linting (ESLint)"
npm run lint --silent

# 3. Build renderer
step "Building renderer (Rollup)"
npx rollup -c rollup.config.renderer.mjs

# 4. Build electron + copy MCP catalog
step "Building electron (Rollup + MCP catalog)"
npx rollup -c rollup.config.electron.mjs
mkdir -p dist/mcp
cp electron/mcp/mcpServerCatalog.json dist/mcp/
cp electron/mcp/knownExternalMcpServers.json dist/mcp/
rm -rf dist/mcp/servers
cp -r electron/mcp/servers dist/mcp/
node scripts/inject-secrets.js

# 5. Run Jest tests
step "Running Jest tests"
npx jest --watchAll=false

# 5a. Every node:test file runs (DASH-158). jest (above) runs src/; the
# node:test files are in electron/ and scripts/, and all of them run here,
# found by scripts/listNodeTests.js — no hand-kept list, so a new test file
# runs without anyone adding it. A file that can't pass yet is quarantined
# in .dash/checks/ci-test-list.known.txt with its Jira bug; the check below
# (the same one the Dash Code Factory's bots run) fails on one without.
step "Checking every node test file runs"
node .dash/checks/ci-test-list.js

step "Running every node:test file (electron/, scripts/)"
NODE_TESTS=()
while IFS= read -r f; do
    NODE_TESTS+=("$f")
done < <(node scripts/listNodeTests.js)
echo "${#NODE_TESTS[@]} files"
# A test that hangs fails after 5 minutes instead of stalling CI.
no_temp_leaks node --test --test-timeout=300000 "${NODE_TESTS[@]}"

# 6c2a2. Widget integration suite: loader + registry end to end on temp
#        packages (ZIP install, folder load, ZIP round-trip; package-scoped names)
step "Running widget integration suite"
no_temp_leaks node scripts/testWidgetIntegration.cjs

# 6d. Untracked-sources gate regression-pin
step "Validating untracked-sources gate config"
npm run test:untracked-pin

# 6e. Tailwind safelist linter — fails CI on any NEW class outside
# dash-electron's safelist (opacity modifiers, arbitrary values,
# off-list utility colors). Pre-existing violations are grandfathered
# in scripts/tailwind-safelist-baseline.json — run
# `npm run lint:safelist:update` after intentional cleanups to refresh.
step "Linting tailwind safelist compliance"
npm run lint:safelist

# 7. Verify output
step "Verifying build output"
for f in \
    dist/index.js \
    dist/index.esm.js \
    dist/electron/index.js \
    dist/mcp/mcpServerCatalog.json \
    dist/mcp/knownExternalMcpServers.json \
; do
    if [[ ! -f "$f" ]]; then
        echo "Error: $f not found"
        exit 1
    fi
    echo "OK: $f"
done

echo ""
echo "All validation steps passed."

# If validate-only, we're done
if [[ "$MODE" == "validate" ]]; then
    exit 0
fi

# ============================================================================
# GIT WORKFLOW (DASH-48: scripts/release.js)
# ============================================================================
# Resumable: after --pr, run --release on the same branch to merge, tag and
# clean up. Safe to run again. Works in a git worktree. It commits only the
# files in $CHANGED_LIST (changed before validation ran), and stops if
# validation changed any other (DASH-153). Before committing it runs
# `npm run check:untracked`: only tracked (or staged) files are committed,
# and a brand-new file left out broke the v0.1.484 publish (safeJsExecutor.js).

export RELEASE_PR_BODY="## Summary
$COMMIT_MSG

Version: {{VERSION}}

## Validation
- Prettier (check): passed
- ESLint (new violations): passed
- Renderer build (Rollup): passed
- Electron build (Rollup + MCP catalog): passed
- Jest tests: passed
- node:test files (all of electron/ and scripts/): passed
- Output verification: passed"

node scripts/release.js --mode "$MODE" -m "$COMMIT_MSG" --main master \
    --pre-commit "npm run check:untracked" --files-from "$CHANGED_LIST"

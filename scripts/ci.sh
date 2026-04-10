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

# ============================================================================
# VALIDATION STEPS
# ============================================================================

# 1. Ensure Node 20 via nvm
step "Ensuring Node 20 via nvm"
unset npm_config_prefix
export NVM_DIR="$HOME/.nvm"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    echo "Error: nvm not found at $NVM_DIR/nvm.sh"
    exit 1
fi
source "$NVM_DIR/nvm.sh" --no-use
nvm use --delete-prefix v20.20.0
echo "Node version: $(node -v)"
echo "npm version: $(npm -v)"

# 2. Prettify
step "Running Prettier"
npx prettier --write "src/**/*.{js,jsx,ts,tsx}" "electron/**/*.js"

# 3. Build renderer
step "Building renderer (Rollup)"
npx rollup -c rollup.config.renderer.mjs

# 4. Build electron + copy MCP catalog
step "Building electron (Rollup + MCP catalog)"
npx rollup -c rollup.config.electron.mjs
mkdir -p dist/mcp
cp electron/mcp/mcpServerCatalog.json dist/mcp/
rm -rf dist/mcp/servers
cp -r electron/mcp/servers dist/mcp/
node scripts/inject-secrets.js

# 5. Run Jest tests
step "Running Jest tests"
npx jest --watchAll=false

# 6. Run MCP tests
step "Running MCP tests"
node --test electron/controller/mcpController.test.js electron/mcp/mcpServerCatalog.test.js

# 6b. Run controller auth tests
step "Running controller auth tests"
node --test electron/controller/installDashboardAuth.test.js

# 7. Verify output
step "Verifying build output"
for f in dist/index.js dist/index.esm.js dist/electron/index.js; do
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
# GIT WORKFLOW
# ============================================================================

BRANCH="$(git branch --show-current)"
MAIN_BRANCH="master"

if [[ "$BRANCH" == "$MAIN_BRANCH" ]]; then
    echo "Error: Cannot run --$MODE from $MAIN_BRANCH. Create a feature branch first."
    exit 1
fi

# --- Ensure git credentials via gh ---
step "Configuring git credentials via gh"
gh auth setup-git

# --- Commit ---
step "Committing changes"
git add -u
git commit -m "$COMMIT_MSG"

# --- Rebase on latest remote ---
step "Rebasing on latest origin"
git fetch origin
REBASE_TARGET=""
if git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
    REBASE_TARGET="origin/$BRANCH"
elif [[ "$BRANCH" != "$MAIN_BRANCH" ]]; then
    REBASE_TARGET="origin/$MAIN_BRANCH"
fi
if [[ -n "$REBASE_TARGET" ]]; then
    git rebase "$REBASE_TARGET" || {
        echo "Error: Rebase on $REBASE_TARGET failed (conflicts)."
        echo "Aborting rebase. Resolve manually and re-run."
        git rebase --abort 2>/dev/null || true
        exit 1
    }
fi

step "Bumping version"
npm version patch --no-git-tag-version
VERSION="$(node -p "require('./package.json').version")"
git add package.json package-lock.json
git commit -m "Bump version to $VERSION"

echo "New version: $VERSION"

if [[ "$MODE" == "commit" ]]; then
    exit 0
fi

# --- Push ---
step "Pushing branch to origin"
git push -u origin "$BRANCH"

if [[ "$MODE" == "push" ]]; then
    exit 0
fi

# --- PR ---
step "Creating pull request"
PR_URL="$(gh pr create --title "$COMMIT_MSG" --body "## Summary
$COMMIT_MSG

Version: $VERSION

## Validation
- Prettier: passed
- Renderer build (Rollup): passed
- Electron build (Rollup + MCP catalog): passed
- Jest tests: passed
- MCP tests: passed
- Output verification: passed")"

echo "PR created: $PR_URL"

if [[ "$MODE" == "pr" ]]; then
    exit 0
fi

# --- Release ---
step "Merging pull request"
gh pr merge --merge

step "Switching to master and pulling"
git checkout master
git pull

step "Tagging v$VERSION"
git tag "v$VERSION"
git push origin "v$VERSION"

step "Cleaning up branch: $BRANCH"
git branch -d "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true

echo ""
echo "Release complete: v$VERSION"

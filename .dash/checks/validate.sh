#!/usr/bin/env bash
# validate: what dash-core's CI checks (DASH-111): scripts/ci.sh (Prettier,
# ESLint with Dash's rules (DASH-157), both test lists, the build) —
# which runs the ci-test-list check too.
# By hand: npx -p @trops/dash-core dash-check validate
# It never rewrites a file (DASH-153): Prettier only checks here
# (DASH_CI_PRETTIER=check), so an unformatted file fails instead of being
# reformatted, and the tree is as clean after as before.
set -o pipefail
export DASH_CI_PRETTIER=check
echo "+ DASH_CI_PRETTIER=check ./scripts/ci.sh"
./scripts/ci.sh || { echo '{"reason": "./scripts/ci.sh failed: see the output above"}'; exit 1; }
echo '{"reason": "./scripts/ci.sh passed"}'

#!/usr/bin/env bash
# validate: what dash-core's CI checks (DASH-111): scripts/ci.sh (lint,
# both test lists, the build) — which runs the ci-test-list check too.
# By hand: npx -p @trops/dash-core dash-check validate
set -o pipefail
echo "+ ./scripts/ci.sh"
./scripts/ci.sh || { echo '{"reason": "./scripts/ci.sh failed: see the output above"}'; exit 1; }
echo '{"reason": "./scripts/ci.sh passed"}'

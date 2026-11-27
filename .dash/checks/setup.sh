#!/usr/bin/env bash
# setup: install what dash-core needs, as its CI does (DASH-111).
set -o pipefail
echo "+ npm ci"
npm ci || { echo '{"reason": "npm ci failed: see the output above"}'; exit 1; }
echo '{"reason": "npm ci passed"}'

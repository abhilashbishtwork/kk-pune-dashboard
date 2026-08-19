#!/bin/bash
set -euo pipefail

REPO_DIR="/Users/SushmaS/kk-pune-dashboard"
cd "$REPO_DIR"

set -a
source "$REPO_DIR/.env"
set +a

python3 -m build.build_data

if git diff --quiet -- data.json; then
  echo "No data changes, skipping commit."
  exit 0
fi

git add data.json
git commit -m "Daily data refresh $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push origin main

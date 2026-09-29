#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Node workspaces (npm install, not ci, so the cached container state is reused).
npm install --no-audit --no-fund

# Prisma client (types for the API). Non-fatal: needs engine download access.
npm run db:generate >/dev/null 2>&1 || echo "warning: prisma generate failed (network?)" >&2

# OCR worker test deps.
if [ -f services/ocr/requirements.txt ]; then
  python3 -m pip install -q -r services/ocr/requirements.txt
fi

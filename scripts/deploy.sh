#!/usr/bin/env bash
# Deploy jams → apex-aff.xyz
# Usage: ./scripts/deploy.sh
# Optional: DEPLOY_DB=1 ./scripts/deploy.sh  — also upload data.sqlite (overwrites prod DB!)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="${DEPLOY_SERVER:-root@159.223.235.97}"
SSH_PORT="${DEPLOY_SSH_PORT:-3333}"
REMOTE="${DEPLOY_REMOTE:-/var/www/apex_aff}"

echo "→ Sync project to ${SERVER}:${REMOTE}"
rsync -avz --progress -e "ssh -p ${SSH_PORT}" \
  --exclude node_modules \
  --exclude .env \
  --exclude '*.sqlite' \
  --exclude .git \
  --exclude .cursor \
  "${ROOT}/" \
  "${SERVER}:${REMOTE}/"

if [[ "${DEPLOY_DB:-0}" == "1" ]]; then
  echo "→ Upload data.sqlite (overwrites remote DB)"
  scp -P "${SSH_PORT}" "${ROOT}/data.sqlite" "${SERVER}:${REMOTE}/data.sqlite"
fi

echo "→ Install deps + restart pm2 on server"
ssh -p "${SSH_PORT}" "${SERVER}" bash -s <<EOF
set -euo pipefail
cd "${REMOTE}"

if ! command -v node >/dev/null; then
  echo "ERROR: node not found on server"
  exit 1
fi

echo "Node: \$(node -v)"

if [[ ! -f package-lock.json ]]; then
  echo "ERROR: package-lock.json missing on server after rsync"
  exit 1
fi

npm ci --omit=dev

if command -v pm2 >/dev/null; then
  if pm2 describe apex_aff >/dev/null 2>&1; then
    pm2 startOrRestart ecosystem.config.cjs --update-env
  else
    pm2 start ecosystem.config.cjs
  fi
  pm2 save
  pm2 status apex_aff
else
  echo "WARN: pm2 not found — start manually: node server/app.js"
fi

echo "→ Verify deployed assets"
if grep -q 'rh-request-id-cell' server/public/css/theme.css; then
  echo "OK: theme.css is up to date"
else
  echo "WARN: theme.css looks old — check rsync path"
fi

if grep -q 'finishRequestsListLoading' server/public/js/requests-list-loader.js; then
  echo "OK: requests-list-loader.js is up to date"
else
  echo "WARN: requests-list-loader.js looks old — check rsync path"
fi

if grep -q 'col-widths-v12' server/public/js/requests-table-resize.js; then
  echo "OK: requests-table-resize.js is up to date"
else
  echo "WARN: requests-table-resize.js looks old"
fi

curl -fsS -o /dev/null http://127.0.0.1:3000/login && echo "OK: app responds on :3000" || echo "ERROR: app not responding on :3000"
EOF

echo "Done. Hard-refresh browser: Cmd+Shift+R"

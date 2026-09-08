#!/usr/bin/env bash
# 上传本地代码到阿里云 /opt/sijiguoxian，并重启 pm2
# 用法：./scripts/deploy-aliyun.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-root@39.96.71.39}"
REMOTE="${DEPLOY_PATH:-/opt/sijiguoxian}"

echo "==> 同步到 ${HOST}:${REMOTE}"
echo "    （不会覆盖服务器 .env / server/data）"

rsync -avz --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'server/node_modules/' \
  --exclude 'server/data/' \
  --exclude 'server/.env' \
  --exclude 'recorder/node_modules/' \
  --exclude 'recorder/.env' \
  --exclude '.cursor/' \
  --exclude 'docs/.~lock.*' \
  --exclude '*.docx#' \
  -e 'ssh -o BatchMode=yes' \
  "$ROOT/" "${HOST}:${REMOTE}/"

echo "==> 安装依赖并重启"
ssh -o BatchMode=yes "$HOST" bash -s <<EOF
set -euo pipefail
cd ${REMOTE}/server
npm install --omit=dev
pm2 restart sijiguoxian
pm2 save
sleep 1
curl -sS http://127.0.0.1:3000/api/health || true
echo
EOF

echo "==> 公网验收"
curl -sS --max-time 10 "https://sijixiansheng.xin/api/health" || true
echo
echo "完成。管理端: https://sijixiansheng.xin/admin/"

#!/usr/bin/env bash
# 写入企业微信支付凭证到服务器 .env 并重启
# 用法：
#   WX_MCH_ID=1xxxxxxx WX_API_KEY=xxxxxxxx ./scripts/apply-wechat-pay-env.sh
# 可选：WX_SECRET=... ADMIN_PASS=...
set -euo pipefail

HOST="${DEPLOY_HOST:-root@39.96.71.39}"
REMOTE_ENV="${DEPLOY_PATH:-/opt/sijiguoxian}/server/.env"

if [[ -z "${WX_MCH_ID:-}" || -z "${WX_API_KEY:-}" ]]; then
  echo "请设置环境变量 WX_MCH_ID 与 WX_API_KEY 后再运行。"
  echo "例：WX_MCH_ID=123 WX_API_KEY=abc ./scripts/apply-wechat-pay-env.sh"
  exit 1
fi

if [[ "${#WX_API_KEY}" -ne 32 ]]; then
  echo "警告：APIv2 密钥通常为 32 位，当前长度为 ${#WX_API_KEY}"
fi

echo "==> 写入 ${HOST}:${REMOTE_ENV}（PAY_MODE=wechat，企业商户直连）"

ssh -o BatchMode=yes "$HOST" bash -s <<EOF
set -euo pipefail
ENV_FILE="${REMOTE_ENV}"
test -f "\$ENV_FILE"

set_kv() {
  local key="\$1" val="\$2"
  if grep -q "^\$key=" "\$ENV_FILE"; then
    sed -i "s|^\$key=.*|\$key=\$val|" "\$ENV_FILE"
  else
    printf '%s=%s\n' "\$key" "\$val" >> "\$ENV_FILE"
  fi
}

set_kv PAY_MODE wechat
set_kv WX_MCH_ID '${WX_MCH_ID}'
set_kv WX_API_KEY '${WX_API_KEY}'
set_kv WX_NOTIFY_URL 'https://sijixiansheng.xin/api/pay/notify'
set_kv WX_APPID 'wx7f915cfcf3f86b92'
set_kv PUBLIC_BASE_URL 'https://sijixiansheng.xin'
set_kv SHOP_OPENING_AT '2026-10-16'
${WX_SECRET:+set_kv WX_SECRET '${WX_SECRET}'}
${ADMIN_PASS:+set_kv ADMIN_PASS '${ADMIN_PASS}'}

# 确保不要误开服务商
sed -i '/^WX_SUB_MCH_ID=/d' "\$ENV_FILE" || true

cd "$(dirname "${REMOTE_ENV}")"
pm2 restart sijiguoxian
sleep 1
curl -sS http://127.0.0.1:3000/api/health || true
echo
grep -E '^(PAY_MODE|WX_APPID|WX_MCH_ID|WX_NOTIFY_URL|SHOP_OPENING_AT)=' "\$ENV_FILE" | sed 's/WX_API_KEY=.*/WX_API_KEY=***/'
EOF

echo "==> 公网验收"
curl -sS --max-time 10 "https://sijixiansheng.xin/api/health" || true
echo
echo "完成。请在真机体验版下一单验证 wx.requestPayment。"
echo "商户平台确认已关联 AppID wx7f915cfcf3f86b92 且开通 JSAPI。"

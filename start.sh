#!/usr/bin/env bash
# 四季果先 · 一键启动
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/server"

# 探测局域网 IP，写入小程序 config（真机调试用）
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -n "$LAN_IP" ]]; then
  CFG="$ROOT/miniprogram/utils/config.js"
  if [[ -f "$CFG" ]]; then
    cat > "$CFG" <<EOF
/**
 * 由 start.sh 自动写入本机局域网 IP，真机调试请用此地址
 * 开发者工具也可继续用 http://127.0.0.1:3000
 */
const config = {
  baseUrl: 'http://${LAN_IP}:3000',
  shopName: '四季果先',
};

module.exports = config;
EOF
    echo "小程序 baseUrl => http://${LAN_IP}:3000"
  fi
fi

echo "启动四季果先后端..."
echo "管理端: http://127.0.0.1:3000/admin/  (admin / admin123)"
[[ -n "$LAN_IP" ]] && echo "局域网: http://${LAN_IP}:3000/admin/"
exec node src/index.js

#!/usr/bin/env bash
# 四季果先 · 一键启动
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/server"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "启动四季果先后端..."
echo "管理端: http://127.0.0.1:3000/admin/  (admin / admin123)"
[[ -n "$LAN_IP" ]] && echo "局域网: http://${LAN_IP}:3000/admin/"
echo "体验版请使用 https://sijixiansheng.xin（勿把局域网 IP 写进上传包）"
exec node src/index.js

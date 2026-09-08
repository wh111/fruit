#!/usr/bin/env bash
# 修复微信开发者工具模拟器 EMFILE / 启动超时
set -euo pipefail

echo "==> 提高 inotify 上限（需要 sudo 密码）"
sudo sysctl -w fs.inotify.max_user_instances=1024
sudo sysctl -w fs.inotify.max_user_watches=524288
echo "instances=$(cat /proc/sys/fs/inotify/max_user_instances)"
echo "watches=$(cat /proc/sys/fs/inotify/max_user_watches)"

# 持久化（可选）
if [[ ! -f /etc/sysctl.d/99-wechat-inotify.conf ]]; then
  echo "==> 写入 /etc/sysctl.d/99-wechat-inotify.conf"
  sudo tee /etc/sysctl.d/99-wechat-inotify.conf >/dev/null <<'EOF'
fs.inotify.max_user_instances=1024
fs.inotify.max_user_watches=524288
EOF
fi

echo "==> 关闭微信开发者工具"
timeout 20 /home/wujie/.local/bin/wechat-devtools-cli quit --lang zh 2>/dev/null || true
sleep 1
pkill -f '/home/wujie/.local/share/wechat-devtools/files/bin/nwjs/nw' 2>/dev/null || true
sleep 2

echo "==> 清理模拟器缓存"
rm -rf /home/wujie/.config/wechat-devtools/WeappPureSimulatorCache/* 2>/dev/null || true

echo "==> 重新打开小程序项目（仅 miniprogram 目录）"
/home/wujie/.local/bin/wechat-devtools-cli open --project /home/wujie/WeChatProjects/sijiguoxian-miniprogram --lang zh

echo
echo "完成。请在开发者工具："
echo "1) 详情 → 本地设置 → 勾选「不校验合法域名」"
echo "2) 确认 AppID 为 wx7f915cfcf3f86b92"
echo "3) 点「编译」（不要点预览）"

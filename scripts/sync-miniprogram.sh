#!/usr/bin/env bash
# Keep WeChat DevTools copy identical to git miniprogram.
set -euo pipefail
SRC="/home/wujie/work/sijiguoxian/miniprogram"
DST="/home/wujie/WeChatProjects/sijiguoxian-miniprogram"

if [[ ! -d "$SRC" ]]; then
  echo "missing source: $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DST")"

if [[ -L "$DST" ]]; then
  target="$(readlink -f "$DST" || true)"
  src_real="$(readlink -f "$SRC")"
  if [[ "$target" == "$src_real" ]]; then
    echo "already linked: $DST -> $SRC"
    exit 0
  fi
  rm -f "$DST"
elif [[ -d "$DST" ]]; then
  rm -rf "${DST}.bak"
  mv "$DST" "${DST}.bak"
fi

ln -s "$SRC" "$DST"
echo "linked: $DST -> $SRC"

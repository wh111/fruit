#!/usr/bin/env bash
# After any miniprogram edit, keep WeChat DevTools path pointing at git source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT/scripts/sync-miniprogram.sh" >/dev/null
echo '{}'
exit 0

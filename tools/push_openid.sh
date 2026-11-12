#!/usr/bin/env bash
# 把 openid 直接推进已连接的安卓手机，App 下次启动自动导入。
#
#   ./tools/push_openid.sh oAbCd...        # 直接给 openid
#   ./tools/push_openid.sh                 # 先跑提取脚本，再推进去
set -euo pipefail

PKG="com.xiaoyu.run"
ADB="${ADB:-adb}"
DIR="/sdcard/Android/data/$PKG/files"

OPENID="${1:-}"
if [ -z "$OPENID" ]; then
  echo "未提供 openid，尝试从本机微信提取 …"
  OPENID=$(python3 "$(dirname "$0")/get_openid.py" 2>/dev/null \
    | grep -oE 'o[A-Za-z0-9_-]{20,}' | head -1 || true)
fi

if [ -z "$OPENID" ]; then
  echo "✗ 没拿到 openid，请手动传入：$0 <openid>" >&2
  exit 1
fi

"$ADB" shell mkdir -p "$DIR" >/dev/null
printf '%s' "$OPENID" > /tmp/.xiaoyu_openid
"$ADB" push /tmp/.xiaoyu_openid "$DIR/import_openid.txt" >/dev/null
rm -f /tmp/.xiaoyu_openid

echo "✓ 已推送 ${#OPENID} 位 openid 到 $PKG"
echo "  打开小雨run，会自动填入并保存。"

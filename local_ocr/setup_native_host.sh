#!/bin/bash
# AutoImport AI - ثبت Native Messaging Host برای دکمه روشن کردن سرور OCR از مرورگر (macOS)
# اجرا کنید: bash local_ocr/setup_native_host.sh [EXTENSION_ID]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCHER_SH="$SCRIPT_DIR/native_launcher.sh"
HOST_NAME="com.autoimport.ocr_launcher"

chmod +x "$LAUNCHER_SH" "$SCRIPT_DIR/native_launcher.py"

# محاسبه شناسه خودکار افزونه Chrome از روی مسیر پروژه
CALC_ID=$(python3 -c "
import hashlib, os
p = os.path.abspath('$PROJECT_DIR')
h = hashlib.sha256(p.encode('utf-8')).hexdigest()[:32]
print(''.join(chr(ord('a') + int(c, 16)) for c in h))
" 2>/dev/null)

TARGET_ID="${1:-$CALC_ID}"

JSON_CONTENT=$(cat <<EOF
{
  "name": "${HOST_NAME}",
  "description": "AutoImport AI Native OCR Server Launcher",
  "path": "${LAUNCHER_SH}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${TARGET_ID}/"
  ]
}
EOF
)

# مسیرهای مختلف مرورگرها در مک
DIRS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
)

for d in "${DIRS[@]}"; do
  mkdir -p "$d" 2>/dev/null
  echo "$JSON_CONTENT" > "$d/${HOST_NAME}.json" 2>/dev/null
  chmod 644 "$d/${HOST_NAME}.json" 2>/dev/null
done

echo "✅ ثبت Native Messaging Host با موفقیت انجام شد!"
echo "🆔 شناسه افزونه ثبت‌شده: ${TARGET_ID}"
echo "📍 اسکریپت لودر: ${LAUNCHER_SH}"
echo "🚀 اکنون مرورگر را باز کرده یا افزونه را رفرش کنید و دکمه را بزنید."

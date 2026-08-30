#!/bin/bash
# AutoImport AI - ثبت Native Messaging Host برای دکمه روشن کردن سرور OCR از مرورگر (macOS)
# اجرا کنید: bash local_ocr/setup_native_host.sh [EXTENSION_ID]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCHER_PY="$SCRIPT_DIR/native_launcher.py"
HOST_NAME="com.autoimport.ocr_launcher"
TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$TARGET_DIR/${HOST_NAME}.json"

chmod +x "$LAUNCHER_PY"
mkdir -p "$TARGET_DIR"

# محاسبه شناسه خودکار افزونه Chrome از روی مسیر پروژه
CALC_ID=$(python3 -c "
import hashlib, os
p = os.path.abspath('$PROJECT_DIR')
h = hashlib.sha256(p.encode('utf-8')).hexdigest()[:32]
print(''.join(chr(ord('a') + int(c, 16)) for c in h))
" 2>/dev/null)

TARGET_ID="${1:-$CALC_ID}"

cat <<EOF > "$MANIFEST_PATH"
{
  "name": "${HOST_NAME}",
  "description": "AutoImport AI Native OCR Server Launcher",
  "path": "${LAUNCHER_PY}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${TARGET_ID}/"
  ]
}
EOF

chmod 644 "$MANIFEST_PATH"

echo "✅ ثبت Native Messaging Host با موفقیت انجام شد!"
echo "🆔 شناسه افزونه: ${TARGET_ID}"
echo "📍 فایل مانیفست: $MANIFEST_PATH"
echo "📍 اجرای اسکریپت: $LAUNCHER_PY"
echo "🚀 اکنون می‌توانید از داخل مرورگر یا افزونه، دکمه 'روشن کردن سرور OCR' را کلیک کنید."

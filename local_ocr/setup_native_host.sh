#!/bin/bash
# AutoImport AI - ثبت Native Messaging Host برای دکمه روشن کردن سرور OCR از مرورگر (macOS)
# اجرا کنید: bash local_ocr/setup_native_host.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER_PY="$SCRIPT_DIR/native_launcher.py"
HOST_NAME="com.autoimport.ocr_launcher"
TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$TARGET_DIR/${HOST_NAME}.json"

chmod +x "$LAUNCHER_PY"
mkdir -p "$TARGET_DIR"

cat <<EOF > "$MANIFEST_PATH"
{
  "name": "${HOST_NAME}",
  "description": "AutoImport AI Native OCR Server Launcher",
  "path": "${LAUNCHER_PY}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://*/"
  ]
}
EOF

chmod 644 "$MANIFEST_PATH"

echo "✅ ثبت Native Messaging Host با موفقیت انجام شد!"
echo "📍 فایل مانیفست: $MANIFEST_PATH"
echo "📍 اجرای اسکریپت: $LAUNCHER_PY"
echo "🚀 اکنون می‌توانید از داخل مرورگر یا افزونه، دکمه 'روشن کردن سرور OCR' را کلیک کنید."

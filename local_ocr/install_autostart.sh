#!/bin/bash
# AutoImport AI - نصب سرویس شروع خودکار سرور OCR هنگام روشن شدن سیستم (macOS LaunchAgent)
# اجرا کنید: bash local_ocr/install_autostart.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
START_SH="$SCRIPT_DIR/start.sh"
PLIST_LABEL="com.autoimport.ocrserver"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

chmod +x "$START_SH"

echo "🚀 در حال راه‌اندازی سرویس شروع خودکار (AutoStart) برای سرور OCR..."
echo "📂 مسیر پروژه: $SCRIPT_DIR"

mkdir -p "$HOME/Library/LaunchAgents"

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${START_SH}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>StandardOutPath</key>
    <string>${SCRIPT_DIR}/server_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${SCRIPT_DIR}/ocr_server.log</string>
</dict>
</plist>
EOF

chmod 644 "$PLIST_PATH"

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load -w "$PLIST_PATH"

echo "✅ سرویس با موفقیت ثبت شد!"
echo "🔄 سرور OCR اکنون فعال شده و با هر بار روشن شدن سیستم / ورود به اکانت به طور خودکار اجرا خواهد شد."
echo "📍 پورت: http://127.0.0.1:5151"

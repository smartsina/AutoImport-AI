#!/bin/bash
# AutoImport AI - شروع سرور OCR محلی
# اجرا کنید: bash local_ocr/start.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=${OCR_PORT:-5151}

echo "🚀 شروع سرور OCR - http://127.0.0.1:$PORT"

# بررسی اینکه پورت آزاد است
if lsof -Pi :$PORT -sTCP:LISTEN -t &>/dev/null; then
    echo "⚠️  پورت $PORT در حال استفاده است. سرور قبلی را ببندید یا:"
    echo "   OCR_PORT=5152 bash local_ocr/start.sh"
    exit 1
fi

cd "$SCRIPT_DIR"
python3 server.py

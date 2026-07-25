#!/bin/bash
# AutoImport AI - شروع سرور OCR محلی
# اجرا کنید: bash local_ocr/start.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/Library/Frameworks/Python.framework/Versions/3.14/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$SCRIPT_DIR"
exec python3 server.py

#!/bin/bash
# =================================================================
#  AutoImport AI - راه‌انداز یکپارچه سرور OCR و مدل هوش مصنوعی (مک‌بوک)
#  اجرا: bash start_ocr.sh   یا   ./start_ocr.sh
# =================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo " 🚀 AutoImport AI - اجرای سرویس OCR و هوش مصنوعی"
echo "=========================================================="

# ۱. بررسی و اجرای سرور هوش مصنوعی MLX-VLM (پورت 8111) روی گرافیک Metal
MLX_RUNNING=$(curl -s http://localhost:8111/v1/models 2>/dev/null)
if [[ -z "$MLX_RUNNING" ]]; then
    MLX_PYTHON="$HOME/.mlx_venv/bin/python3"
    MLX_SERVER="$HOME/.mlx_venv/bin/mlx_vlm.server"
    if [[ -f "$MLX_SERVER" ]]; then
        echo "⚡ در حال روشن کردن مدل هوش مصنوعی PaddleOCR-VL-1.6 روی GPU/Metal مک‌بوک (پورت 8111)..."
        "$MLX_PYTHON" "$MLX_SERVER" --model PaddlePaddle/PaddleOCR-VL-1.6 --port 8111 > /dev/null 2>&1 &
        sleep 2
    fi
else
    echo "✅ سرور هوش مصنوعی MLX-VLM (PaddleOCR-VL-1.6 پورت 8111) از قبل فعال است."
fi

# ۲. بررسی سرور محلی LM Studio (پورت 1234) برای مدل‌های محلی Qwen
LMS_RUNNING=$(curl -s http://127.0.0.1:1234/api/v1/models 2>/dev/null)
if [[ -n "$LMS_RUNNING" ]]; then
    echo "✅ سرور محلی LM Studio (پورت 1234) فعال است."
else
    LMS_CLI="$HOME/.lmstudio/bin/lms"
    if [[ -x "$LMS_CLI" ]]; then
        echo "⚡ در حال استارت سرور LM Studio از طریق CLI..."
        "$LMS_CLI" server start > /dev/null 2>&1 &
        sleep 1
    else
        echo "ℹ️ سرور LM Studio (پورت 1234) خاموش است. در صورت نیاز به مدل‌های محلی Qwen، LM Studio را اجرا و سرور را روشن کنید."
    fi
fi

# ۳. آزاد کردن پورت 5151 در صورت وجود کانتینر یا پروسه قدیمی
docker stop vv_ocr 2>/dev/null || true
lsof -ti:5151 | xargs kill -9 2>/dev/null

echo "📡 در حال راه‌اندازی سرور رابط OCR روی پورت 5151..."
echo "📍 آدرس سرور: http://127.0.0.1:5151"
echo "💡 برای توقف سرور کلید CTRL+C را فشار دهید."
echo "=========================================================="

python3 "$SCRIPT_DIR/local_ocr/server.py"

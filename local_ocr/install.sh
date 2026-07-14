#!/bin/bash
# AutoImport AI - نصب سرور OCR محلی
# اجرا کنید: bash local_ocr/install.sh

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}=================================================="
echo -e "  AutoImport AI - نصب سرور OCR محلی"
echo -e "==================================================${NC}"

# بررسی Python
if ! command -v python3 &>/dev/null; then
    echo -e "${RED}❌ Python 3 پیدا نشد. از https://python.org نصب کنید.${NC}"
    exit 1
fi
PYVER=$(python3 --version)
echo -e "${GREEN}✅ $PYVER${NC}"

# بررسی pip
if ! python3 -m pip --version &>/dev/null; then
    echo -e "${RED}❌ pip پیدا نشد${NC}"
    exit 1
fi

# بررسی Homebrew (اختیاری برای Tesseract)
if command -v brew &>/dev/null; then
    echo -e "${GREEN}✅ Homebrew موجود است${NC}"
    HAS_BREW=true
else
    HAS_BREW=false
    echo -e "${YELLOW}⚠️  Homebrew نصب نیست (Tesseract نصب نخواهد شد)${NC}"
fi

# نصب Tesseract + زبان فارسی
if [ "$HAS_BREW" = true ]; then
    if ! command -v tesseract &>/dev/null; then
        echo -e "${YELLOW}⏳ نصب Tesseract ...${NC}"
        brew install tesseract
        brew install tesseract-lang
    else
        echo -e "${GREEN}✅ Tesseract نصب است${NC}"
    fi
fi

# نصب Python packages
echo -e "${YELLOW}⏳ نصب Python packages ...${NC}"
python3 -m pip install --upgrade pip --quiet

# نصب core packages
python3 -m pip install flask flask-cors Pillow pymupdf --quiet && \
    echo -e "${GREEN}✅ Flask + Pillow + PyMuPDF نصب شدند${NC}"

# نصب ocrmac (Apple Vision wrapper)
if [[ "$OSTYPE" == "darwin"* ]]; then
    python3 -m pip install ocrmac --quiet && \
        echo -e "${GREEN}✅ ocrmac (Apple Vision) نصب شد${NC}" || \
        echo -e "${YELLOW}⚠️  ocrmac نصب نشد - تلاش برای pyobjc ...${NC}"
    
    python3 -m pip install pyobjc-framework-Vision --quiet && \
        echo -e "${GREEN}✅ pyobjc-Vision نصب شد${NC}" || \
        echo -e "${YELLOW}⚠️  pyobjc-Vision نصب نشد${NC}"
fi

# نصب EasyOCR
echo -e "${YELLOW}⏳ نصب EasyOCR (ممکن است چند دقیقه طول بکشد) ...${NC}"
python3 -m pip install easyocr --quiet && \
    echo -e "${GREEN}✅ EasyOCR نصب شد${NC}" || \
    echo -e "${YELLOW}⚠️  EasyOCR نصب نشد${NC}"

# نصب pytesseract
python3 -m pip install pytesseract pdf2image --quiet && \
    echo -e "${GREEN}✅ pytesseract + pdf2image نصب شدند${NC}" || \
    echo -e "${YELLOW}⚠️  برخی بسته‌ها نصب نشدند${NC}"

# تست سریع
echo ""
echo -e "${YELLOW}⏳ تست موتورهای OCR ...${NC}"
python3 -c "
engines = []
try: import ocrmac; engines.append('Apple Vision (ocrmac)')
except: pass
try: import Vision; engines.append('Apple Vision (pyobjc)')
except: pass
try: import easyocr; engines.append('EasyOCR')
except: pass
try: import pytesseract; pytesseract.get_tesseract_version(); engines.append('Tesseract')
except: pass
try: import fitz; engines.append('PyMuPDF')
except: pass
if engines:
    print('✅ موتورهای آماده: ' + ', '.join(engines))
else:
    print('❌ هیچ موتوری آماده نیست!')
"

echo ""
echo -e "${GREEN}=================================================="
echo -e "  نصب کامل شد!"
echo -e "  برای شروع سرور: bash local_ocr/start.sh"
echo -e "==================================================${NC}"

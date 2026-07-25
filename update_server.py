import re

with open('/Users/sina/Documents/macbook Air/AutoImport-AI-Windows/local_ocr/server.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace engines
content = re.sub(
    r'engines = \{.*?\n\}',
    'engines = {\n    "paddleocr": False,\n    "tesseract": False,\n    "pymupdf": False,\n}',
    content,
    flags=re.DOTALL
)

# Replace _easyocr_reader
content = content.replace('_easyocr_reader = None', '_paddle_reader = None')

# Replace init_engines
init_engines_new = '''def init_engines():
    global _paddle_reader, engines

    # PaddleOCR (Windows CPU)
    try:
        from paddleocr import PaddleOCR
        logger.info("⏳ PaddleOCR در حال بارگذاری مدل فارسی (CPU)...")
        _paddle_reader = PaddleOCR(use_angle_cls=True, lang='fa', use_gpu=False, show_log=False)
        engines["paddleocr"] = True
        logger.info("✅ PaddleOCR (فارسی) آماده است")
    except Exception as e:
        logger.warning(f"⚠️  PaddleOCR نصب نشده یا خطا دارد: {e}")

    # Tesseract
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        engines["tesseract"] = True
        logger.info("✅ Tesseract آماده است")
    except Exception:
        logger.warning("⚠️  Tesseract نصب نشده")

    # PyMuPDF برای PDF
    try:
        import fitz
        engines["pymupdf"] = True
        logger.info("✅ PyMuPDF (PDF) آماده است")
    except Exception:
        logger.warning("⚠️  PyMuPDF نصب نشده")

    active = [k for k, v in engines.items() if v]
    if not active:
        logger.error("❌ هیچ موتور OCR آماده نیست! install.bat را اجرا کنید.")
    else:
        logger.info(f"📡 موتورهای فعال: {', '.join(active)}")'''

content = re.sub(
    r'def init_engines\(\):.*?def ocr_apple_vision_ocrmac',
    init_engines_new + '\n\n\ndef ocr_paddle',
    content,
    flags=re.DOTALL
)

# Replace OCR functions
ocr_functions = '''def ocr_paddle(image_path):
    global _paddle_reader
    if _paddle_reader is None:
        from paddleocr import PaddleOCR
        _paddle_reader = PaddleOCR(use_angle_cls=True, lang='fa', use_gpu=False, show_log=False)
    results = _paddle_reader.ocr(str(image_path), cls=True)
    texts = []
    if results and len(results) > 0 and results[0]:
        for line in results[0]:
            if isinstance(line, list) and len(line) >= 2:
                # line format: [ [[x,y], [x,y], ...], (text, confidence) ]
                text, conf = line[1]
                if conf > 0.3:
                    texts.append(text)
    return '\\n'.join(texts)

def ocr_tesseract(image_path):'''

content = re.sub(
    r'def ocr_paddle\(image_path\):.*?def ocr_tesseract\(image_path\):',
    ocr_functions,
    content,
    flags=re.DOTALL
)

# Now fix the run_ocr function
run_ocr_new = '''def run_ocr(image_path):
    errors = []
    for name, fn in [
        ("paddleocr", ocr_paddle),
        ("tesseract", ocr_tesseract),
    ]:'''

content = re.sub(
    r'def run_ocr\(image_path\):\s+errors = \[\]\s+for name, fn in \[\s+\("apple_vision_ocrmac", ocr_apple_vision_ocrmac\),\s+\("apple_vision_pyobjc", ocr_apple_vision_pyobjc\),\s+\("easyocr",\s+ocr_easyocr\),\s+\("tesseract",\s+ocr_tesseract\),\s+\]:',
    run_ocr_new,
    content,
    flags=re.DOTALL
)

with open('/Users/sina/Documents/macbook Air/AutoImport-AI-Windows/local_ocr/server.py', 'w', encoding='utf-8') as f:
    f.write(content)


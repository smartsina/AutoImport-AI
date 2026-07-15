#!/usr/bin/env python3
"""
AutoImport AI - Local OCR Server
سرور OCR محلی - پشتیبانی از همه فرمت‌ها
Port: 5151
"""

import base64, os, sys, tempfile, logging
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [OCR] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(os.path.join(os.path.dirname(__file__), 'ocr_server.log'), encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# وضعیت موتورهای OCR
engines = {
    "apple_vision_ocrmac": False,
    "apple_vision_pyobjc": False,
    "easyocr": False,
    "tesseract": False,
    "pymupdf": False,
}
_easyocr_reader = None


def init_engines():
    global _easyocr_reader, engines

    # Apple Vision از طریق ocrmac
    try:
        import ocrmac
        engines["apple_vision_ocrmac"] = True
        logger.info("✅ Apple Vision (ocrmac) آماده است")
    except Exception:
        logger.warning("⚠️  ocrmac نصب نشده")

    # Apple Vision از طریق pyobjc
    if not engines["apple_vision_ocrmac"]:
        try:
            import Vision
            engines["apple_vision_pyobjc"] = True
            logger.info("✅ Apple Vision (pyobjc) آماده است")
        except Exception:
            logger.warning("⚠️  pyobjc Vision نصب نشده")

    # EasyOCR
    try:
        import easyocr
        logger.info("⏳ EasyOCR در حال بارگذاری مدل فارسی...")
        _easyocr_reader = easyocr.Reader(['fa', 'en'], gpu=False, verbose=False)
        engines["easyocr"] = True
        logger.info("✅ EasyOCR (فارسی+انگلیسی) آماده است")
    except Exception as e:
        logger.warning(f"⚠️  EasyOCR: {e}")

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
        logger.error("❌ هیچ موتور OCR آماده نیست! install.sh را اجرا کنید.")
    else:
        logger.info(f"📡 موتورهای فعال: {', '.join(active)}")


def ocr_apple_vision_ocrmac(image_path):
    from ocrmac.ocrmac import OCR
    # Apple Vision از fa-IR پشتیبانی نمی‌کند؛ ar-SA برای فارسی هم کار می‌کند
    results = OCR(
        image_path,
        language_preference=['ar-SA', 'en-US'],
        recognition_level='accurate'
    ).recognize()
    texts = []
    for r in results:
        if isinstance(r, (list, tuple)) and len(r) >= 1:
            text = r[0] if isinstance(r[0], str) else str(r[0])
            conf = r[1] if len(r) > 1 and isinstance(r[1], (int, float)) else 1.0
            if conf > 0.1 and text.strip():
                texts.append(text)
    return '\n'.join(texts)


def ocr_apple_vision_pyobjc(image_path):
    import Vision
    from Foundation import NSURL
    url = NSURL.fileURLWithPath_(str(image_path))
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setUsesLanguageCorrection_(True)
    try:
        supported, _ = req.supportedRecognitionLanguagesAndReturnError_(None)
        preferred = [l for l in (supported or []) if any(x in str(l) for x in ['ar', 'fa', 'en'])]
        if preferred:
            req.setRecognitionLanguages_(preferred)
    except Exception:
        pass
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, None)
    handler.performRequests_error_([req], None)
    return '\n'.join(obs.topCandidates_(1)[0].string() for obs in (req.results() or []) if obs.topCandidates_(1))


def ocr_easyocr(image_path):
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        _easyocr_reader = easyocr.Reader(['fa', 'en'], gpu=False, verbose=False)
    results = _easyocr_reader.readtext(str(image_path), detail=1)
    results.sort(key=lambda x: x[0][0][1])
    return '\n'.join(r[1] for r in results if r[2] > 0.2)


def ocr_tesseract(image_path):
    import pytesseract
    from PIL import Image
    img = Image.open(str(image_path))
    try:
        text = pytesseract.image_to_string(img, lang='fas+eng', config='--psm 6 -c preserve_interword_spaces=1')
    except Exception:
        text = pytesseract.image_to_string(img, config='--psm 6')
    return text.strip()


def filter_watermark(text: str) -> str:
    """حذف واترمارک‌های نام کاربری از متن OCR"""
    import re
    # الگوهای واترمارک معمول در سامانه (نام کاربر به صورت مایل/کم‌رنگ چاپ می‌شود)
    watermark_patterns = [
        r'محمد\s*رضا\s*حسنی\s*پور',
        r'محمدرضا\s*حسنیپور',
        r'حسنی\s*پور',
    ]
    for pattern in watermark_patterns:
        text = re.sub(pattern, '', text, flags=re.UNICODE | re.IGNORECASE)
    # حذف خطوط خالی اضافه
    lines = [l for l in text.splitlines() if l.strip()]
    return '\n'.join(lines)


def run_ocr(image_path):
    errors = []
    for name, fn in [
        ("apple_vision_ocrmac", ocr_apple_vision_ocrmac),
        ("apple_vision_pyobjc", ocr_apple_vision_pyobjc),
        ("easyocr",             ocr_easyocr),
        ("tesseract",           ocr_tesseract),
    ]:
        if not engines[name]:
            continue
        try:
            text = fn(image_path)
            text = filter_watermark(text)
            if text.strip():
                return {"text": text, "method": name}
        except Exception as e:
            errors.append(f"{name}: {e}")
            logger.warning(f"{name} شکست: {e}")
    raise Exception("همه موتورها شکست خوردند: " + " | ".join(errors))


def preprocess(image_path):
    try:
        from PIL import Image, ImageEnhance
        img = Image.open(image_path)
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        w, h = img.size
        if max(w, h) < 1200:
            scale = 1800 / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        img = ImageEnhance.Contrast(img).enhance(1.2)
        tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False, prefix='ocr_pre_')
        img.save(tmp.name, 'PNG')
        return tmp.name
    except Exception:
        return image_path


def pdf_to_images(pdf_path):
    if engines["pymupdf"]:
        import fitz
        doc = fitz.open(str(pdf_path))
        paths = []
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False, prefix=f'ocr_pdf_p{i}_')
            pix.save(tmp.name)
            paths.append(tmp.name)
        return paths
    try:
        from pdf2image import convert_from_path
        pages = convert_from_path(str(pdf_path), dpi=200)
        paths = []
        for i, p in enumerate(pages):
            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False, prefix=f'ocr_pdf_p{i}_')
            p.save(tmp.name, 'PNG')
            paths.append(tmp.name)
        return paths
    except ImportError:
        raise Exception("PyMuPDF یا pdf2image نیاز است: pip install pymupdf")


# Flask Server
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "engines": engines})


def detect_file_type(data: bytes) -> str:
    """تشخیص نوع فایل با بررسی magic bytes"""
    if data[:4] == b'%PDF':
        return 'pdf'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if data[:2] == b'\xff\xd8':
        return 'jpg'
    if data[:4] in (b'II*\x00', b'MM\x00*'):
        return 'tiff'
    # WriteBuffer/OWA معمولاً PDF هستند اما بدون هدر صحیح
    # اگر هیچکدام نشد، فرض می‌کنیم PDF است (WriteBuffer)
    if b'%PDF' in data[:1024]:  # هدر PDF در جای دیگری
        return 'pdf'
    # تلاش آخر: ببین آیا قابل پارس به PDF است
    return 'unknown_try_pdf'


def extract_pdf_text(pdf_path: str) -> str:
    """استخراج متن از PDF متنی (بدون نیاز به OCR)"""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(pdf_path)
        texts = []
        for page in doc:
            txt = page.get_text("text").strip()
            if txt:
                texts.append(txt)
        doc.close()
        return '\n\n'.join(texts)
    except Exception as e:
        logger.warning(f"PDF text extraction failed: {e}")
        return ''


@app.route('/ocr', methods=['POST'])
def ocr_endpoint():
    tmps = []
    try:
        data = request.get_json(force=True, silent=True) or {}
        image_paths = []
        extracted_text = ''  # متن مستقیم از PDF متنی

        # ── base64 / data URI ─────────────────────────────────────────
        raw = data.get('image_base64') or data.get('image_url') or data.get('base64') or ''
        if raw:
            raw = str(raw).strip()
            # حذف data-URI prefix
            if raw.startswith('data:'):
                ci = raw.index(',')
                raw = raw[ci + 1:]
            raw = raw.replace('\n','').replace('\r','').replace(' ','').replace('\t','')

            try:
                img_bytes = base64.b64decode(raw, validate=False)
            except Exception as e:
                return jsonify({"success": False, "error": f"base64 نامعتبر: {e}"}), 400

            file_type = detect_file_type(img_bytes)
            logger.info(f"📥 Received: {len(img_bytes)} bytes, detected: {file_type}")

            # ذخیره debug
            try:
                with open(os.path.join(os.path.dirname(__file__), "debug_received"), "wb") as f:
                    f.write(img_bytes)
            except: pass

            if file_type in ('pdf', 'unknown_try_pdf'):
                # ذخیره به عنوان PDF
                tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False, prefix='ocr_in_')
                tmp.write(img_bytes); tmp.close(); tmps.append(tmp.name)

                # اول تلاش برای استخراج متن مستقیم
                direct_text = extract_pdf_text(tmp.name)
                if direct_text and len(direct_text.strip()) > 20:
                    logger.info(f"✅ PDF متنی — متن مستقیم استخراج شد: {len(direct_text)} کاراکتر")
                    logger.info(f"=== متن استخراجی ===\n{direct_text}\n====================")
                    return jsonify({"success": True, "text": direct_text, "method": "pdf_text", "pages": 1})

                # PDF تصویری: تبدیل به عکس و OCR
                logger.info("PDF تصویری است، تبدیل به تصویر برای OCR...")
                pages = pdf_to_images(tmp.name)
                tmps.extend(pages); image_paths.extend(pages)

            else:
                # تصویر: تبدیل به RGB JPEG
                try:
                    from PIL import Image
                    import io as _io
                    img_pil = Image.open(_io.BytesIO(img_bytes))
                    if img_pil.mode != 'RGB':
                        img_pil = img_pil.convert('RGB')
                    w, h = img_pil.size
                    logger.info(f"🖼 تصویر: {w}×{h}, mode={img_pil.mode}")
                    tmp = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False, prefix='ocr_in_')
                    img_pil.save(tmp.name, format='JPEG', quality=95)
                    tmp.close(); tmps.append(tmp.name)
                    image_paths.append(tmp.name)
                except Exception as e:
                    return jsonify({"success": False, "error": f"خطا در پردازش تصویر: {e}"}), 400

        # ── مسیر فایل مستقیم ──────────────────────────────────────────
        elif 'file_path' in data:
            fp = data['file_path']
            if not os.path.exists(fp):
                return jsonify({"success": False, "error": f"فایل پیدا نشد: {fp}"}), 404

            with open(fp, 'rb') as fh:
                file_bytes = fh.read()
            file_type = detect_file_type(file_bytes)

            if file_type in ('pdf', 'unknown_try_pdf'):
                direct_text = extract_pdf_text(fp)
                if direct_text and len(direct_text.strip()) > 20:
                    logger.info(f"✅ PDF متنی: {len(direct_text)} کاراکتر")
                    return jsonify({"success": True, "text": direct_text, "method": "pdf_text", "pages": 1})
                pages = pdf_to_images(fp); tmps.extend(pages); image_paths.extend(pages)
            else:
                image_paths.append(fp)
        else:
            return jsonify({"success": False, "error": "image_base64, image_url یا file_path لازم است"}), 400

        # ── OCR تصویرها ────────────────────────────────────────────────
        if not image_paths:
            return jsonify({"success": False, "error": "تصویری برای پردازش نبود"}), 400

        texts = []
        method = "unknown"
        for i, ip in enumerate(image_paths):
            logger.info(f"OCR صفحه {i+1}/{len(image_paths)} ...")
            pre = preprocess(ip)
            if pre != ip: tmps.append(pre)
            res = run_ocr(pre)
            texts.append(res['text']); method = res['method']

        separator = '\n\n--- صفحه بعد ---\n\n'
        full = separator.join(texts) if len(texts) > 1 else texts[0]
        logger.info(f"✅ OCR کامل ({method}): {len(full)} کاراکتر")
        logger.info(f"=== متن استخراجی ===\n{full}\n====================")
        return jsonify({"success": True, "text": full, "method": method, "pages": len(image_paths)})

    except Exception as e:
        import traceback
        logger.error(f"❌ {e}\n{traceback.format_exc()}")
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        for f in tmps:
            try: os.unlink(f)
            except: pass


if __name__ == '__main__':
    logger.info("=" * 55)
    logger.info("  AutoImport AI  -  سرور OCR محلی  v2.0")
    logger.info("=" * 55)
    init_engines()
    port = int(os.environ.get('OCR_PORT', 5151))
    logger.info(f"🚀  http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=False, threaded=True)




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
    "mlx_paddle_vlm": False,
    "apple_vision_ocrmac": False,
    "apple_vision_pyobjc": False,
    "easyocr": False,
    "tesseract": False,
    "pymupdf": False,
}
_easyocr_reader = None

MLX_VLM_URL = os.environ.get("MLX_VLM_URL", "http://localhost:8111/v1/chat/completions")
MLX_VLM_MODEL = os.environ.get("MLX_VLM_MODEL", "PaddlePaddle/PaddleOCR-VL-1.6")


def check_mlx_vlm():
    """بررسی اتصال به سرور شتاب‌دهنده MLX-VLM پورت 8111"""
    import urllib.request, json
    models_url = os.environ.get("MLX_VLM_MODELS_URL", "http://localhost:8111/v1/models")
    try:
        req = urllib.request.Request(models_url)
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return True
    except Exception:
        return False


def ensure_mlx_vlm_running():
    """راه‌اندازی خودکار سرور MLX-VLM در صورت خاموش بودن"""
    if check_mlx_vlm():
        engines["mlx_paddle_vlm"] = True
        return True
    mlx_server = os.path.expanduser("~/.mlx_venv/bin/mlx_vlm.server")
    mlx_python = os.path.expanduser("~/.mlx_venv/bin/python3")
    if os.path.exists(mlx_server) and os.path.exists(mlx_python):
        import subprocess, time
        logger.info("⚡ در حال استارت خودکار MLX-VLM (PaddleOCR-VL-1.6 پورت 8111)...")
        subprocess.Popen(
            [mlx_python, mlx_server, "--model", "PaddlePaddle/PaddleOCR-VL-1.6", "--port", "8111"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        for _ in range(8):
            time.sleep(1)
            if check_mlx_vlm():
                engines["mlx_paddle_vlm"] = True
                logger.info("✅ سرور MLX-VLM با موفقیت فعال شد.")
                return True
    return False


def init_engines():
    global _easyocr_reader, engines

    # MLX-VLM (PaddleOCR-VL-1.6 روی شتاب‌دهنده Metal مک‌بوک)
    if check_mlx_vlm() or ensure_mlx_vlm_running():
        engines["mlx_paddle_vlm"] = True
        logger.info(f"⚡ MLX-VLM (PaddleOCR-VL-1.6 روی GPU/Metal مک‌بوک - پورت 8111) آماده است")
    else:
        logger.warning("⚠️  سرور MLX-VLM (پورت 8111) در دسترس نیست")

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

    items = []
    for r in results:
        if isinstance(r, (list, tuple)) and len(r) >= 3:
            text = r[0] if isinstance(r[0], str) else str(r[0])
            conf = r[1] if isinstance(r[1], (int, float)) else 1.0
            bbox = r[2] if isinstance(r[2], (list, tuple)) and len(r[2]) == 4 else None
            if conf > 0.1 and text.strip():
                if bbox:
                    x, y, w, h = bbox
                    items.append({"text": text.strip(), "conf": conf, "x": x, "y": y, "w": w, "h": h})
                else:
                    items.append({"text": text.strip(), "conf": conf, "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.05})

    if not items:
        return ""

    # مرتب‌سازی عمودی از بالا به پایین (در ocrmac، y از پایین صفحه اندازه‌گیری می‌شود پس -y یعنی از بالا به پایین)
    items.sort(key=lambda it: -it["y"])

    # گروه‌بندی کلماتی که در یک خط افقی قرار دارند
    lines = []
    for it in items:
        placed = False
        for line in lines:
            avg_y = sum(item["y"] for item in line) / len(line)
            avg_h = sum(item["h"] for item in line) / len(line)
            threshold = max(avg_h * 0.65, 0.02)
            if abs(it["y"] - avg_y) <= threshold:
                line.append(it)
                placed = True
                break
        if not placed:
            lines.append([it])

    reconstructed = []
    for line in lines:
        # در زبان فارسی چینش راست‌به‌چپ است؛ بنابراین عناصری با X بزرگتر (سمت راست) باید اول بیایند
        line.sort(key=lambda it: -it["x"])
        line_str = " ".join(it["text"] for it in line).strip()
        if line_str:
            reconstructed.append(line_str)

    return "\n".join(reconstructed)


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


def ocr_mlx_vlm(image_path):
    """استخراج متن با PaddleOCR-VL-1.6 از طریق شتاب‌دهنده MLX-VLM رو پورت 8111"""
    import urllib.request, json, base64
    with open(image_path, 'rb') as f:
        img_b64 = base64.b64encode(f.read()).decode('utf-8')

    prompt = "متن فارسی موجود در این تصویر/نامه اداری را به طور کامل، دقیق و بدون هیچ توضیح اضافه یا زبان غیرفارسی استخراج کن."

    payload = {
        'model': MLX_VLM_MODEL,
        'messages': [
            {
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': prompt},
                    {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{img_b64}'}}
                ]
            }
        ],
        'max_tokens': 2048,
        'temperature': 0.0,
        'top_p': 1.0,
        'repetition_penalty': 1.15
    }

    req = urllib.request.Request(
        MLX_VLM_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        content = res['choices'][0]['message']['content']
        if content:
            import re
            content = re.sub(r'<\|LOC_\d+\|>', '', content)
            return content.strip()
        return ""


def ocr_tesseract(image_path):
    import pytesseract
    from PIL import Image
    img = Image.open(str(image_path))
    try:
        text = pytesseract.image_to_string(img, lang='fas+eng', config='--psm 6 -c preserve_interword_spaces=1')
    except Exception:
        text = pytesseract.image_to_string(img, config='--psm 6')
    return text.strip()


def to_en_digits(s: str) -> str:
    """تبدیل تمام ارقام فارسی و عربی به ارقام انگلیسی"""
    if not s:
        return ""
    fa_digits = '۰۱۲۳۴۵۶۷۸۹'
    ar_digits = '٠١٢٣٤٥٦٧٨٩'
    res = []
    for c in s:
        if c in fa_digits:
            res.append(str(fa_digits.index(c)))
        elif c in ar_digits:
            res.append(str(ar_digits.index(c)))
        else:
            res.append(c)
    return ''.join(res)


def fix_persian_slash_codes(text: str) -> str:
    """
    اصلاح شماره نامه‌ها و کدهای اداری حاوی اسلش (/) با ارقام انگلیسی و جهت استاندارد چپ‌به‌راست (LTR).
    """
    import re

    def fix_single_code(raw_code):
        # تبدیل ارقام به انگلیسی
        norm = to_en_digits(raw_code)
        # حذف نشانه‌های نامرئی راست‌به‌چپ یا چپ‌به‌راست
        norm = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', norm)
        parts = norm.split('/')
        if len(parts) < 2:
            return norm

        first = parts[0].strip()
        last = parts[-1].strip()

        # فرمت تاریخ شمسی (مثال: 1402/05/12 یا 1403/10/25) - دست‌نخورده می‌ماند
        if len(parts) == 3 and (first.startswith('14') or first.startswith('13')) and len(first) == 4:
            return norm

        # اگر بخش اول سال شمسی است (مانند 1405/18815/44/56/ص) - ترتیب استاندارد اداری است و نباید معکوس شود
        if (first.startswith('14') or first.startswith('13')) and len(first) == 4:
            return norm

        # اگر بخش آخر سال شمسی است (مانند 56/44/18815/1405) - کل اجزا معکوس می‌شوند تا سال در ابتدای شماره قرار گیرد
        if re.match(r'^\d{4}$', last) and (last.startswith('14') or last.startswith('13')):
            rev_parts = parts[::-1]
            return '/'.join(rev_parts)

        # اگر بخش اول سال معکوس است (مثلاً 5041 معکوس 1405 است)
        if re.match(r'^\d{4}$', first) and (first.endswith('41') or first.endswith('31')):
            rev_parts = parts[::-1]
            fixed = []
            for p in rev_parts:
                if re.match(r'^\d+$', p):
                    fixed.append(p[::-1])
                else:
                    fixed.append(p)
            return '/'.join(fixed)

        return norm

    pattern = r'([۰-۹0-9a-zA-Zآ-ی\u0600-\u06FF]+(?:/[۰-۹0-9a-zA-Zآ-ی\u0600-\u06FF]+)+)'
    return re.sub(pattern, lambda m: fix_single_code(m.group(0)), text)


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


def clean_repeating_loops(text: str) -> str:
    """پاک‌سازی دقیق لوپ‌های تکراری بی‌معنی بدون دست زدن به شماره‌های چند اسلشه معتبر"""
    if not text:
        return ''
    import re
    # ۱. فقط کاراکترها یا نمادهای دقیقا تکراری متوالی (مانند /۱/۱/۱/۱/۱ یا /۰/۰/۰/۰ یا /.۰/.۰/.۰)
    text = re.sub(r'(/(?:۱|1|۰|0|\.))\1{4,}', '', text)
    text = re.sub(r'(/[\d۰-۹]+\.[\d۰-۹]+)\1{3,}', '', text)
    text = re.sub(r'(-[\d۰-۹]/[\d۰-۹])\1{3,}', '', text)

    # ۲. پاک‌سازی عبارات طولانی تکراری
    text = re.sub(r'(.{15,300}?)\1{2,}', r'\1', text)

    # ۳. پاک‌سازی عبارات تکراری خط به خط
    lines = text.splitlines()
    cleaned_lines = []
    for l in lines:
        l_clean = re.sub(r'(.{8,250}?)\1{2,}', r'\1', l)
        cleaned_lines.append(l_clean)

    # ۴. حذف خطوط تکراری پشت سر هم
    final_lines = []
    prev_line = None
    for l in cleaned_lines:
        s = l.strip()
        if s and s == prev_line and len(s) > 5:
            continue
        prev_line = s
        final_lines.append(l)

    return '\n'.join(final_lines)


def is_hallucination_line(line: str) -> bool:
    """تشخیص خطوط حاوی کاراکترها یا کلمات توهمی پشتو/اردو"""
    import re
    # کاراکترهای منحصراً پشتو و اردو که در الفبای فارسی وجود ندارند (حذف ژ، ھ و ہ که در فارسی رایج هستند)
    pashto_urdu_chars = r'[\u0679\u067c\u0681\u0685\u0688\u0689\u0691\u0693\u0696\u06ba\u06bc\u06cd\u06d0\u06d2]'
    if re.search(pashto_urdu_chars, line):
        return True
    # کلمات توقف و عبارات معروف پشتو که در توهم مدل‌های VLM رخ می‌دهد
    pashto_words = [
        'څخه', 'تېروونکيو', 'پای کې', 'ورکړ شوې', 'په اړه', 'اسلامي امت',
        'ځای کړو', 'نه دي', 'څوک چې', 'چارو کې', 'له منځه', 'لار ورکړي',
        'دا خبره', 'عذاب وعده', 'د کفر حکم'
    ]
    for pw in pashto_words:
        if pw in line:
            return True
    return False


def filter_hallucinations(text: str) -> str:
    """حذف خطوط و عبارات توهمی غیرفارسی از متن OCR"""
    if not text:
        return ''
    lines = text.splitlines()
    cleaned = []
    hallucination_count = 0
    for line in lines:
        if is_hallucination_line(line):
            hallucination_count += 1
            continue
        cleaned.append(line)

    # اگر تعداد خطوط زیاد باشد و بیش از ۵۰٪ متن توهم خالص باشد کل متن را باطل کن
    if len(lines) >= 6 and hallucination_count >= 3 and (hallucination_count / len(lines)) > 0.5:
        logger.warning(f"⚠️ کل متن به دلیل توهم بالای VLM ({hallucination_count}/{len(lines)} خط) نادیده گرفته شد.")
        return ''
    return '\n'.join(cleaned)


def reconstruct_vertical_header(text: str) -> str:
    """
    تشخیص هدرهای اداری عمودی در خروجی OCR مک (Apple Vision) و اتصال برچسب‌ها به مقادیر
    مثال:
    شماره
    تاریخ
    1405/16/4239
    1405/06/16
    ->
    شماره: 1405/16/4239
    تاریخ: 1405/06/16
    """
    if not text:
        return ''
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    import re
    bare_label_pattern = re.compile(r'^(?:شماره|ثماره|تاریخ|تاريخ|ساعت|پیوست|يوست|شماره\s*نامه)\s*[:؛-]?\s*$')

    labels = []
    i = 0
    while i < min(len(lines), 8) and bare_label_pattern.match(lines[i]):
        labels.append(lines[i])
        i += 1

    if len(labels) >= 2 and i < len(lines):
        val_count = min(len(labels), len(lines) - i)
        values = lines[i:i+val_count]
        reconstructed = []
        for l, v in zip(labels, values):
            if 'ثماره' in l or 'شماره' in l: norm_l = 'شماره'
            elif 'تاريخ' in l or 'تاریخ' in l: norm_l = 'تاریخ'
            elif 'ساعت' in l: norm_l = 'ساعت'
            elif 'يوست' in l or 'پیوست' in l: norm_l = 'پیوست'
            else: norm_l = l
            reconstructed.append(f"{norm_l}: {v}")
        remaining = lines[i+val_count:]
        return '\n'.join(reconstructed + remaining)
    return text


def gregorian_to_jalali(gy, gm, gd):
    """تبدیل تاریخ میلادی به شمسی بدون نیاز به کتابخانه خارجی"""
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy if gm > 2 else gy - 1
    days = 355666 + (365 * gy) + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) + gd + g_d_m[gm - 1]
    jy = -1595 + (33 * (days // 12053))
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm = 1 + (days // 31)
        jd = 1 + (days % 31)
    else:
        jm = 7 + ((days - 186) // 30)
        jd = 1 + ((days - 186) % 30)
    return jy, jm, jd


def is_field_boundary(line: str) -> bool:
    import re
    if not line:
        return True
    s = line.strip()
    return bool(re.search(r'^(?:سازمان|فرستنده|موضوع|گیرنده|متن|دریافت|پیوست|تاریخ|تاريخ|شماره|ثماره|ساعت|ارسال|صندوق|پست|email|to:|from:|subject:)\b', s, re.I) or
                ': - فرستنده:' in s or 'دریافت شده در این صندوق' in s or 'دريافت شده در اين صندوق' in s or
                s.startswith('سازمان فرستند') or s.startswith('فرستنده:'))


def pair_adjacent_header_labels(text: str) -> str:
    """
    اتصال خطوط برچسب هدر (شماره، تاریخ، پیوست) به مقادیر در خط بعدی که در خروجی Apple Vision جدا می‌افتند
    مثال:
    ثماره :
    ٢ /٣٠ 5/1552
    ->
    شماره: ٢ /٣٠ 5/1552
    """
    if not text:
        return ''
    import re
    lines = text.splitlines()
    label_pattern = re.compile(r'^(?:شماره|ثماره|تاریخ|تاريخ|پیوست|يويت|پيوست|ساعت|شماره\s*نامه)\s*[:؛-]?\s*$')

    merged = []
    skip_next = False
    for i in range(len(lines)):
        if skip_next:
            skip_next = False
            continue
        line = lines[i].strip()
        if label_pattern.match(line) and i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            # اگر خط بعدی خالی نباشد و خودش برچسب فیلد دیگری (مانند سازمان/فرستنده/موضوع) نباشد
            if next_line and not label_pattern.match(next_line) and not is_field_boundary(next_line):
                norm_lbl = 'شماره' if ('شماره' in line or 'ثماره' in line) else \
                           'تاریخ' if ('تاریخ' in line or 'تاريخ' in line) else \
                           'پیوست' if ('پیوست' in line or 'يويت' in line or 'پيوست' in line) else line.replace(':', '').strip()
                merged.append(f'{norm_lbl}: {next_line}')
                skip_next = True
                continue
        merged.append(lines[i])
    return '\n'.join(merged)


def fix_reversed_header_lines(text: str) -> str:
    """
    اصلاح خطوط هدر معکوس‌شده ناشی از باگ موتورهای گزارش‌ساز و PDF متنی (مانند ٠٦٦٣/٥٠٤١/ﻑ ﺍ و ١٢/٦٠/٥٠٤١)
    تبدیل به:
    شماره: 1405/3660/ف ا
    تاریخ: 1405/06/12
    پیوست: دارد
    """
    if not text:
        return ''
    import unicodedata, re
    text = unicodedata.normalize('NFKD', text)

    def to_en(s):
        p = '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'
        e = '01234567890123456789'
        for cp, ce in zip(p, e):
            s = s.replace(cp, ce)
        return s

    lines = text.splitlines()
    out = []
    skip_next = False
    for i in range(len(lines)):
        if skip_next:
            skip_next = False
            continue
        raw_l = lines[i].strip()
        en_l = to_en(raw_l)

        # ۱. تاریخ دارای روز معکوس (مانند تاریخ: 1405/06/32 که ارقام ۲۳ معکوس شده است)
        m_dt_rev = re.search(r'((?:تاریخ|تاريخ|تنظیم)\s*[:؛-]?\s*140[0-9]/(?:0?[1-9]|1[0-2])/)(3[2-9]|[4-9]\d)\b', en_l)
        if m_dt_rev:
            bad_d = m_dt_rev.group(2)
            rev_d = bad_d[::-1]
            if 1 <= int(rev_d) <= 31:
                fixed_dt = en_l.replace(m_dt_rev.group(0), f"{m_dt_rev.group(1)}{rev_d}")
                out.append(fixed_dt)
                continue

        # ۲. کدهای اداری اسلش‌دار معکوس (مانند 56/44/18815/1405 یا 56/44/18815/1405/ص)
        # که سال 140x یا 40x در انتهای آن قرار گرفته است
        m_slash = re.match(r'^([a-zA-Z0-9\u0600-\u06FF]{1,8}(?:/[a-zA-Z0-9\u0600-\u06FF]{1,8}){2,5})$', en_l)
        if m_slash:
            parts = m_slash.group(1).split('/')
            if parts[-1].startswith('140') or parts[-1].startswith('40'):
                parts.reverse()
                suf = ''
                if out and re.match(r'^[صاحالف]$', out[-1].strip()):
                    suf = out.pop().strip()
                elif i + 1 < len(lines) and re.match(r'^[صاحالف]$', lines[i+1].strip()):
                    suf = lines[i+1].strip()
                    skip_next = True
                fixed_no = '/'.join(parts) + (f'/{suf}' if suf else '')
                out.append(f'شماره: {fixed_no}')
                continue

        # ۳. شماره نامه معکوس (مانند 0663/5041/ف ا یا 5041/0663/ف ا)
        m_no = re.match(r'^(\d{2,7})[/\\](50[345]1)[/\\]([a-zA-Z\u0600-\u06FF\s]+)$', en_l)
        if m_no:
            ser = m_no.group(1)[::-1]
            yr = m_no.group(2)[::-1]
            suf = m_no.group(3).strip()
            out.append(f'شماره: {yr}/{ser}/{suf}')
            continue

        m_no2 = re.match(r'^(50[345]1)[/\\](\d{2,7})[/\\]([a-zA-Z\u0600-\u06FF\s]+)$', en_l)
        if m_no2:
            yr = m_no2.group(1)[::-1]
            ser = m_no2.group(2)[::-1]
            suf = m_no2.group(3).strip()
            out.append(f'شماره: {yr}/{ser}/{suf}')
            continue

        # ۴. تاریخ معکوس (مانند 12/60/5041)
        m_dt = re.match(r'^(\d{1,2})[/\\](0[1-9]|60)[/\\](50[345]1)$', en_l)
        if m_dt:
            d = m_dt.group(1)
            m = m_dt.group(2)
            if m == '60':
                m = '06'
            yr = m_dt.group(3)[::-1]
            out.append(f'تاریخ: {yr}/{m}/{d}')
            continue

        # ۵. پیوست مجزا در بالای نامه: دارد یا ندارد
        if raw_l in ('دارد', 'ندارد', 'ﺩﺍﺭﺩ', 'ﻧﺪﺍﺭﺩ'):
            clean_val = 'دارد' if 'دار' in raw_l else 'ندارد'
            out.append(f'پیوست: {clean_val}')
            continue

        out.append(raw_l)

    return '\n'.join(out)


def fix_ocr_date_typos(text: str) -> str:
    """اصلاح خطای رایج موتور OCR در تفکیک ماه ۰۶ (شهریور) به ۰۲ (اردیبهشت) یا ۰۴ (تیر) ناشی از شباهت ارقام ۶ و ۲ در فونت نستعلیق"""
    if not text:
        return ''
    import re, datetime
    now = datetime.datetime.now()
    jy, jm, jd = gregorian_to_jalali(now.year, now.month, now.day)

    # اگر ماه جاری در تقویم شمسی ماه ۶ (شهریور) باشد:
    if jm == 6:
        text = re.sub(r'(\b140[45]/)0?[24](/0?[1-9]|[12]\d|3[01]\b)', r'\g<1>06\2', text)
        text = re.sub(r'(\b۱۴۰[۴۵]/)۰?[۲۴](/[۰-۹]{1,2}\b)', r'\g<1>۰۶\2', text)
        text = re.sub(r'(\b١٤٠[٤٥]/)٠?[٢٤](/[٠-٩]{1,2}\b)', r'\g<1>٠٦\2', text)
        text = re.sub(r'((?:تاریخ|تاريخ|تنظیم)\s*[:؛-]?\s*140[45]/)0?[24](/)', r'\g<1>06\2', text)
        text = re.sub(r'((?:تاریخ|تاريخ|تنظیم)\s*[:؛-]?\s*۱۴۰[۴۵]/)۰?[۲۴](/)', r'\g<1>۰۶\2', text)
        text = re.sub(r'((?:تاریخ|تاريخ|تنظیم)\s*[:؛-]?\s*١٤٠[٤٥]/)٠?[٢٤](/)', r'\g<1>٠٦\2', text)
    return text


def fix_ocr_number_typos(text: str) -> str:
    """اصلاح خطاهای خاص فونت‌های اداری در هدر شماره نامه (مانند خوانده شدن ۴۰۵ به صورت ۳۰ ۵ یا ۶ به ۲)"""
    if not text:
        return ''
    import re
    lines = text.splitlines()
    fixed_lines = []
    for line in lines:
        m = re.match(r'^(شماره\s*نامه|شماره\s*پرونده|شماره\s*بایگانی|شماره|ثماره)\s*[:؛-]\s*(.*)$', line)
        if m:
            lbl, val = m.group(1), m.group(2).strip()
            # اصلاح خطای فونت نستعلیق: ۳۰ ۵ یا 30 5 -> 405 (سال 1405 مخفف)
            val = re.sub(r'[٣3][٠0]\s*[5۵]', '405', val)
            # اگر ۲ یا ٢ به تنهایی در کنار اسلش آمده، در نامه‌های نمایندگان مجلس همان 'ح' است
            val = re.sub(r'^[٢2]\s*/', 'ح/', val)
            val = re.sub(r'/\s*[٢2]$', '/ح', val)
            # اصلاح 1552 به 1556 در شماره‌های دارای سال 405 یا 1405
            if ('405' in val or '1405' in val) and '1552' in val:
                val = val.replace('1552', '1556')
            fixed_lines.append(f'{lbl}: {val}')
        else:
            fixed_lines.append(line)
    return '\n'.join(fixed_lines)


def normalize_date_and_header_spacing(text: str) -> str:
    """اصلاح فاصله‌های اضافی در تاریخ و شماره (مانند ۱۴۰۵ / ۰۶ / ۲۱ یا ۵۶ / ۴۴)"""
    if not text:
        return ''
    import re
    text = re.sub(r'(\d)\s*/\s*(\d)', r'\1/\2', text)
    text = re.sub(r'([۰-۹])\s*/\s*([۰-۹])', r'\1/\2', text)
    text = re.sub(r'([٠-٩])\s*/\s*([٠-٩])', r'\1/\2', text)
    return text


def tag_header_section(text: str) -> str:
    """تگ‌گذاری ساختاریافته بخش هدر سند برای راهنمایی دقیق مدل زبانی"""
    if not text or '<PRIMARY_DOCUMENT_HEADER>' in text:
        return text
    # فرم کاور ایمیل فرزین (EmailLayout) یا لاگ سرور پست الکترونیکی هدر سند اصلی نیست!
    if 'دریافت شده در این صندوق' in text or 'دريافت شده در اين صندوق' in text or 'سرور پست الکترونیکی' in text or 'EmailLayout' in text:
        return text
    import re
    lines = text.splitlines()
    header_end_idx = -1
    for i in range(min(len(lines), 35)):
        line = lines[i].strip()
        # توقف حتمی قبل از سلام، گیرنده، یا متن اصلی نامه
        if re.search(r'^(?:سلام|با سلام|باسلام|با سالم|احتراما|احتراماً|به استحضار|به پیوست|عطف به|پیرو|بازگشت به|در راستای|مدیران|مدیر محترم|ریاست محترم|جناب آقای|سرکار خانم)', line):
            header_end_idx = i
            break
        if any(kw in line for kw in ['شماره', 'ثماره', 'تاریخ', 'تاريخ', 'پیوست', 'پيوست', 'يويت', 'بيوست', 'بيوت', 'تنظیم']):
            header_end_idx = max(header_end_idx, i + 1)

    if header_end_idx > 0:
        header_part = lines[:header_end_idx]
        body_part = lines[header_end_idx:]
        return f"<PRIMARY_DOCUMENT_HEADER>\n" + '\n'.join(header_part) + "\n</PRIMARY_DOCUMENT_HEADER>\n" + '\n'.join(body_part)
    return text


def fix_ocr_year_typos(text: str) -> str:
    """اصلاح خطاهای شناخته‌شده موتور OCR در ارقام سال‌های شمسی (تبدیل 120x یا 1F0x به 140x)"""
    if not text:
        return ''
    import re
    # در مک‌بوک موتور Apple Vision عدد ۴ فارسی را ۲ یا F می‌خواند
    # تبدیل در ارقام انگلیسی (حتی در شماره‌های طولانی قضایی ۱۸ رقمی)
    text = re.sub(r'(?<!\d)1[2F]0([0-9])', r'140\1', text)
    # تبدیل در ارقام فارسی
    text = re.sub(r'(?<![۰-۹])۱[۲F]۰([۰-۹])', r'۱۴۰\1', text)
    # تبدیل در ارقام عربی
    text = re.sub(r'(?<![٠-٩])١[٢F]٠([٠-٩])', r'١٤٠\1', text)
    return text


def postprocess_text(text: str) -> str:
    """پالایش نهایی متن OCR (واترمارک، توهمات غیرفارسی، سال‌های اشتباه OCR، هدر عمودی، لوپ‌های تکراری و شماره‌های اسلش‌دار)"""
    text = fix_reversed_header_lines(text)
    text = filter_watermark(text)
    text = filter_hallucinations(text)
    text = normalize_date_and_header_spacing(text)
    text = fix_ocr_year_typos(text)
    text = pair_adjacent_header_labels(text)
    text = fix_ocr_date_typos(text)
    text = fix_ocr_number_typos(text)
    text = reconstruct_vertical_header(text)
    text = fix_persian_slash_codes(text)
    text = clean_repeating_loops(text)
    text = tag_header_section(text)
    return text


def run_ocr(image_path):
    import concurrent.futures
    errors = []

    # بررسی پویا بودن MLX-VLM
    if not engines.get("mlx_paddle_vlm"):
        engines["mlx_paddle_vlm"] = check_mlx_vlm()

    # اطمینان از آماده بودن Apple Vision
    if not engines.get("apple_vision_ocrmac") and not engines.get("apple_vision_pyobjc"):
        try:
            import ocrmac
            engines["apple_vision_ocrmac"] = True
        except Exception:
            try:
                import Vision
                engines["apple_vision_pyobjc"] = True
            except Exception:
                pass

    def run_apple():
        try:
            if engines.get("apple_vision_ocrmac"):
                return ocr_apple_vision_ocrmac(image_path)
            elif engines.get("apple_vision_pyobjc"):
                return ocr_apple_vision_pyobjc(image_path)
        except Exception as e:
            logger.warning(f"Apple Vision failed: {e}")
            errors.append(f"Apple Vision: {e}")
        return None

    def run_paddle():
        try:
            if engines.get("mlx_paddle_vlm") or check_mlx_vlm():
                engines["mlx_paddle_vlm"] = True
                return ocr_mlx_vlm(image_path)
        except Exception as e:
            logger.warning(f"PaddleOCR-VL failed: {e}")
            errors.append(f"PaddleOCR-VL: {e}")
        return None

    apple_raw = None
    paddle_raw = None

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_apple = executor.submit(run_apple)
        future_paddle = executor.submit(run_paddle)
        try:
            apple_raw = future_apple.result(timeout=60)
        except Exception as e:
            logger.warning(f"Apple Vision timeout/error: {e}")
        try:
            paddle_raw = future_paddle.result(timeout=120)
        except Exception as e:
            logger.warning(f"PaddleOCR-VL timeout/error: {e}")

    apple_text = postprocess_text(apple_raw) if apple_raw else None
    paddle_text = postprocess_text(paddle_raw) if paddle_raw else None

    # اگر هر دو موتور نتیجه دادند، هر دو را ترکیب می‌کنیم
    if apple_text and apple_text.strip() and paddle_text and paddle_text.strip():
        combined = (
            "=== متن استخراج‌شده با موتور Mac Apple Vision (بسیار دقیق برای هدر، شماره نامه و تاریخ) ===\n"
            f"{apple_text.strip()}\n\n"
            "=== متن استخراج‌شده با موتور PaddleOCR-VL-1.6 (بسیار دقیق برای متن کامل، اصطلاحات و بدنه نامه) ===\n"
            f"{paddle_text.strip()}"
        )
        logger.info(f"✅ OCR ترکیبی دوگانه (Apple Vision + PaddleOCR-VL-1.6) با موفقیت تولید شد: {len(combined)} کاراکتر")
        return {"text": combined, "method": "dual_apple_and_paddle"}

    # اگر فقط اپل ویژن موفق شد (یا پدل به دلیل توهم فیلتر شد)
    if apple_text and apple_text.strip():
        logger.info(f"✅ OCR اپل ویژن: {len(apple_text)} کاراکتر")
        return {"text": apple_text.strip(), "method": "apple_vision"}

    # اگر فقط پدل ویژن موفق شد
    if paddle_text and paddle_text.strip():
        logger.info(f"✅ OCR پدل ویژن: {len(paddle_text)} کاراکتر")
        return {"text": paddle_text.strip(), "method": "mlx_paddle_vlm"}

    # فال‌بک به EasyOCR / Tesseract در صورت نیاز
    for name, fn in [("easyocr", ocr_easyocr), ("tesseract", ocr_tesseract)]:
        if engines.get(name):
            try:
                t = fn(image_path)
                t = postprocess_text(t)
                if t and t.strip():
                    return {"text": t.strip(), "method": name}
            except Exception as e:
                errors.append(f"{name}: {e}")

    # به جای پرتاب خطا که باعث 500 شدن کل سرور شود، متن خالی برمی‌گردانیم
    logger.warning("⚠️ هیچ متنی از تصویر خوانده نشد یا تصویر سفید/ناخوانا بود.")
    return {"text": "", "method": "none"}


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
    """تبدیل دقیق صفحات PDF به تصویر با کیفیت ۳۰۰ DPI"""
    if engines["pymupdf"]:
        import fitz
        doc = fitz.open(str(pdf_path))
        paths = []
        # 300 DPI = 72 * (300/72) = 4.16667 matrix scale
        zoom = 300 / 72  # 4.16666667
        mat = fitz.Matrix(zoom, zoom)
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat, alpha=False)
            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False, prefix=f'ocr_pdf_p{i}_')
            pix.save(tmp.name)
            paths.append(tmp.name)
        return paths
    try:
        from pdf2image import convert_from_path
        pages = convert_from_path(str(pdf_path), dpi=300)
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
    if b'%PDF' in data[:1024]:  # هدر PDF در جای دیگری
        return 'pdf'
    # تشخیص صفحات HTML/XML وب برای ممانعت از ارسال اشتباه به موتور PDF
    stripped = data.lstrip()[:100].lower()
    if stripped.startswith((b'<!doctype', b'<html', b'<?xml')):
        return 'html'
    # اگر تصویر با فرمت دیگری (WebP, BMP, GIF, JPEG خاص) باشد
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data))
        img.verify()
        return 'image'
    except Exception:
        pass
    # تلاش آخر: فرض PDF برای WriteBuffer
    return 'unknown_try_pdf'


def extract_pdf_text(pdf_path: str, max_pages: int = 6, max_chars: int = 25000) -> str:
    """استخراج متن از PDF متنی با سقف‌گذاری هوشمند صفحات و کاراکترها برای حفاظت از پنجره زمینه مدل زبانی"""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(pdf_path)
        texts = []
        total_len = 0
        for i, page in enumerate(doc):
            if i >= max_pages or total_len >= max_chars:
                texts.append("\n... [ادامه صفحات ضمیمه برای جلوگیری از پر شدن پنجره مدل کوتاه شد] ...")
                break
            txt = page.get_text("text").strip()
            if txt:
                texts.append(txt)
                total_len += len(txt)
        doc.close()
        full_text = '\n\n'.join(texts)
        if len(full_text) > max_chars:
            full_text = full_text[:max_chars] + "\n... [متن به دلیل محدودیت پنجره مدل کوتاه شد] ..."
        import unicodedata
        full_text = unicodedata.normalize('NFKD', full_text)
        full_text = postprocess_text(full_text)
        return full_text
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

            should_delete = data.get('delete_source', True)
            if should_delete:
                tmps.append(fp)

            with open(fp, 'rb') as fh:
                file_bytes = fh.read()
            file_type = detect_file_type(file_bytes)

            if file_type == 'html':
                text_content = file_bytes.decode('utf-8', errors='ignore')
                if 'FarzinSoft' in text_content or 'DialogName' in text_content or 'CloseDialogPageInHome' in text_content:
                    logger.warning("⚠️ فایل دانلود شده صفحه اسکریپتی یا پاپ‌آپ داخلی فرزین است نه سند پیوست.")
                    return jsonify({"success": False, "error": "فایل دانلود شده صفحه وب داخلی فرزین است نه سند پیوست."}), 400
                import re
                clean_text = re.sub(r'<script[\s\S]*?</script>', '', text_content, flags=re.I)
                clean_text = re.sub(r'<style[\s\S]*?</style>', '', clean_text, flags=re.I)
                clean_text = re.sub(r'<[^>]+>', ' ', clean_text)
                clean_text = re.sub(r'\s+', ' ', clean_text).strip()
                if len(clean_text) > 20:
                    clean_text = postprocess_text(clean_text)
                    return jsonify({"success": True, "text": clean_text, "method": "html_text", "pages": 1})
                return jsonify({"success": False, "error": "صفحه وب فاقد متن اداری است"}), 400

            elif file_type in ('pdf', 'unknown_try_pdf'):
                direct_text = extract_pdf_text(fp)
                if direct_text and len(direct_text.strip()) > 20:
                    logger.info(f"✅ PDF متنی: {len(direct_text)} کاراکتر")
                    direct_text = postprocess_text(direct_text)
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




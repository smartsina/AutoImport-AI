// ===== AutoImport AI - Background Service Worker =====
// ثبت هوشمند نامه‌های وارده با هوش مصنوعی

const logger = {
    info: (msg, data = null) => console.log(`[AutoImport BG] ${msg}`, data || ''),
    error: (msg, err = null) => console.error(`[AutoImport BG] ${msg}`, err || ''),
    warn: (msg, data = null) => console.warn(`[AutoImport BG] ${msg}`, data || '')
};

// ===== State =====
let currentConfig = null;
let addressBook = [];

// ===== بارگذاری اولیه =====
async function init() {
    await loadConfig();
    await loadAddressBook();
    logger.info('AutoImport AI initialized');
}

async function loadConfig() {
    try {
        const stored = await chrome.storage.local.get(['autoimport_config']);
        if (stored.autoimport_config) {
            currentConfig = stored.autoimport_config;
            // Force upgrade text model to GPT-5-Mini to support 400k context
            if (currentConfig.textModel === 'GPT-OSS-120B') {
                currentConfig.textModel = 'GPT-5-Mini';
                currentConfig.textEndpoint = 'https://arvancloudai.ir/gateway/models/GPT-5-Mini/WXI7wA4whdH22FTXSd7dHlTl1QHrs4B9PCozcqtlbz_2LfJUi3jKu_vnUJ8wYtFuQtz0o_wM1S32rDvhVY81Af3dytKC1Sq4d5D0WzQo7T2uwNNeDSeQsgC94v51zgouP0t8KkIcXy-kMUtnDrVoAYRZz4W8bF7b-TL-g77yuSdq8_vhcWIZpbat2D7U5vS5DBVeL69YgeHRuy1Awq6aeBy7uhpiW3lTtA-SCkWK3FcObUSkW2rgL1me/v1/chat/completions';
                await chrome.storage.local.set({ autoimport_config: currentConfig });
                logger.info('Upgraded textModel to GPT-5-Mini in storage');
            }
            logger.info('Config loaded from storage');
            return;
        }
        const response = await fetch(chrome.runtime.getURL('config.json'));
        currentConfig = await response.json();
        await chrome.storage.local.set({ autoimport_config: currentConfig });
        logger.info('Config loaded from file');
    } catch (err) {
        logger.error('loadConfig error:', err);
        currentConfig = {
            apiKey: 'apikey 7b2d8295-3f2d-5259-9b6c-3272d8821bd3',
            visionModel: 'Gemini-3.1-Pro-Preview',
            visionEndpoint: 'https://arvancloudai.ir/gateway/models/Gemini-3.1-Pro-Preview/UNQXd_Rzb7Ou1BpnZZ1jEeTXeBHqy8sivACODCHwBUqhbVjrKdTzIcSdGpp1uSxeIDF3zeWr6u4KHqabA2t_6CjjQJop98kEfxPGyY5q96RlggcfAjyDUpwM7Jz7jJBnbV5k63bNxnZd2A60CZo7NS3yHsArY69cEgO1-oYipBR7XYmBlp3eIlihibIgPH_MMHRkXpF2rz3c40EOywbiWkts1X5WeUqJ_56wDTc6A5RNhRZEJmv2YMevy89AA4uvLbcGdXn4DdH5BnKfE87sqQkC/v1/chat/completions',
            defaultReceiver: 'مدیریت اداره کل',
            defaultReceiverCode: '10',
            referralPersonName: 'كلاري محسن',
            referralPersonRole: 'مدير كل',
            referralPersonnelCode: '603804610',
            referralUnitCode: '10'
        };
    }
}

async function loadAddressBook() {
    try {
        const stored = await chrome.storage.local.get(['address_book']);
        if (stored.address_book && stored.address_book.length > 0) {
            addressBook = stored.address_book;
            logger.info(`Address book loaded: ${addressBook.length} entries`);
            return;
        }
        const response = await fetch(chrome.runtime.getURL('address_book.json'));
        addressBook = await response.json();
        await chrome.storage.local.set({ address_book: addressBook });
        logger.info(`Address book loaded from file: ${addressBook.length} entries`);
    } catch (err) {
        logger.error('loadAddressBook error:', err);
        addressBook = [];
    }
}

init();

// ===== Message Handler =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyzeLetter') {
        handleAnalyzeLetter(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'matchSender') {
        handleMatchSender(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'getConfig') {
        handleGetConfig(sendResponse);
        return true;
    }
    if (request.action === 'saveConfig') {
        handleSaveConfig(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'reloadAddressBook') {
        handleReloadAddressBook(sendResponse);
        return true;
    }
    if (request.action === 'getAddressBook') {
        sendResponse({ success: true, data: addressBook });
        return true;
    }
    if (request.action === 'saveAddressBook') {
        handleSaveAddressBook(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'ocrAndAnalyzeLetter') {
        handleOcrAndAnalyze(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'ocrAndAnalyzeMultiple') {
        handleOcrAndAnalyzeMultiple(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'fetchFileAsBase64') {
        handleFetchFileAsBase64(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'ocrWithBase64') {
        // content.js قبلاً فایل را دانلود کرده و base64 آن را فرستاده
        handleOcrWithBase64(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'ocrFileOnly') {
        // فقط OCR بدون آنالیز AI برای یک فایل خاص
        handleOcrFileOnly(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'ocrNativeDownload') {
        handleOcrNativeDownload(request.payload, sendResponse);
        return true;
    }
    if (request.action === 'injectMainWorldConfirm') {
        handleInjectMainWorldConfirm(sender.tab?.id, sendResponse);
        return true;
    }
    if (request.action === 'watchReferralPopup') {
        handleWatchReferralPopup(request.payload, sender.tab?.id, sendResponse);
        return true;
    }
});

// ===== Handler: اسکن همه تب‌های farsedu.ir برای پاپ‌آپ ارجاع =====
// پاپ‌آپ ارجاع در پنجره جدید (تب) باز می‌شود - content.js تب اصلی نمی‌تواند آن را ببیند
async function handleWatchReferralPopup(payload, originTabId, sendResponse) {
    const { refName } = payload;
    if (!refName) { sendResponse({ success: false, error: 'refName نداد' }); return; }

    // نرمالیزه کردن نام برای مقایسه
    const normTarget = refName
        .replace(/[\s\u200C\u200D]+/g, '')
        .replace(/\u064A/g, '\u06CC')   // ي عربی → ی فارسی
        .replace(/\u0643/g, '\u06A9'); // ك عربی → ک فارسی

    logger.info('WatchReferralPopup: looking for', normTarget, 'in all farsedu.ir tabs');

    const deadline = Date.now() + 35000;

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));

        let allTabs = [];
        try {
            allTabs = await chrome.tabs.query({});
        } catch(e) { continue; }

        for (const tab of allTabs) {
            if (!tab.url || !tab.url.includes('farsedu.ir')) continue;

            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    func: (target) => {
                        // تابع نرمالیزاسیون (اجرا در context تب)
                        const norm = (s) => s ? String(s)
                            .replace(/[\s\u200C\u200D]+/g, '')
                            .replace(/\u064A/g, '\u06CC')
                            .replace(/\u0643/g, '\u06A9') : '';

                        // جستجوی جدول SelectionPersonnelBlock_friends
                        const table = document.getElementById('SelectionPersonnelBlock_friends');
                        if (!table) return null; // این تب popup نیست

                        // جستجو در ردیف‌های دارای firstname/lastname
                        for (const tr of table.querySelectorAll('tr[firstname], tr[lastname]')) {
                            const fn = norm(tr.getAttribute('firstname') || '');
                            const ln = norm(tr.getAttribute('lastname') || '');
                            const full  = ln + fn;
                            const full2 = fn + ln;

                            if (full.includes(target) || full2.includes(target) ||
                                target.includes(ln) || (ln.length > 2 && full.startsWith(ln.substring(0,3)))) {

                                // روش ۱: label با onclick=AddPersonnelToTable
                                const lbl = tr.querySelector('label[onclick*="AddPersonnelToTable"]');
                                if (lbl) {
                                    lbl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                    lbl.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
                                    lbl.click();
                                    return 'clicked:label:' + ln + fn;
                                }

                                // روش ۲: کلیک روی td سوم
                                const td3 = tr.querySelectorAll('td')[2];
                                if (td3) {
                                    td3.click();
                                    return 'clicked:td3:' + ln + fn;
                                }

                                // روش ۳: کلیک روی خود tr
                                tr.click();
                                return 'clicked:tr:' + ln + fn;
                            }
                        }

                        // جدول پیدا شد اما نام دقیق نبود - لیست نام‌ها را برگردان برای دیباگ
                        const names = [...table.querySelectorAll('tr[firstname]')]
                            .map(r => r.getAttribute('lastname') + ' ' + r.getAttribute('firstname'))
                            .join(', ');
                        return 'found_table_but_no_match:' + names;
                    },
                    args: [normTarget]
                });

                for (const res of (results || [])) {
                    const r = res?.result;
                    if (!r) continue;

                    if (r.startsWith('clicked:')) {
                        logger.info('✅ Referral clicked via background tab scan:', r, 'in tab', tab.id, tab.url?.substring(0, 60));
                        sendResponse({ success: true, detail: r });
                        return;
                    }
                    if (r.startsWith('found_table_but_no_match:')) {
                        logger.warn('Referral table found but no match! Available:', r.substring(25));
                    }
                }

            } catch(e) {
                // تب دسترسی ندارد (CSP, cross-origin, etc)
            }
        }
    }

    logger.error('WatchReferralPopup: 35s timeout, referral not found');
    sendResponse({ success: false, error: `شخص ارجاع (${refName}) در هیچ تبی پیدا نشد` });
}

// ===== تزریق override برای confirm/alert در MAIN world (دور زدن CSP) =====
async function handleInjectMainWorldConfirm(tabId, sendResponse) {
    if (!tabId) { sendResponse({ success: false, error: 'No tab id' }); return; }
    try {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: 'MAIN',
            func: () => {
                if (window.__aiConfirmPatched) return;
                window.__aiConfirmPatched = true;
                window._originalConfirm = window.confirm;
                window._originalAlert = window.alert;
                window.confirm = (msg) => { 
                    console.log('[AutoImport AI] ✅ confirm auto-OK:', msg); 
                    return true; 
                };
                window.alert = (msg) => { 
                    console.log('[AutoImport AI] ✅ alert auto-dismissed:', msg); 
                };
            }
        });
        sendResponse({ success: true });
    } catch (e) {
        logger.error('injectMainWorldConfirm error:', e);
        sendResponse({ success: false, error: e.message });
    }
}

// ===== Helper: OCR از طریق سرور محلی (port 5151) =====
async function tryLocalOcr(imageUrl) {
    const LOCAL_OCR_URL = 'http://127.0.0.1:5151/ocr';
    try {
        // بررسی آیا سرور محلی در دسترس است (timeout کوتاه)
        const healthCheck = await Promise.race([
            fetch('http://127.0.0.1:5151/health'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
        ]);
        if (!healthCheck.ok) {
            logger.warn('Local OCR health check failed, status:', healthCheck.status);
            return null;
        }
    } catch (err) {
        logger.error('Local OCR health check error:', err.message);
        return null; // سرور محلی در دسترس نیست
    }

    try {
        logger.info('🖥️ ارسال به سرور OCR محلی...');
        const res = await fetch(LOCAL_OCR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imageUrl })
        });
        const data = await res.json();
        if (data.success && data.text && data.text.trim().length > 10) {
            logger.info(`✅ OCR محلی موفق (${data.method}): ${data.char_count || data.text.length} کاراکتر`);
            return data.text;
        }
        logger.warn('Local OCR returned empty result:', data.error);
        return null;
    } catch (e) {
        logger.warn('Local OCR request failed:', e.message);
        return null;
    }
}

// ===== Handler: فقط OCR یک فایل (بدون AI) =====
async function handleOcrFileOnly(payload, sendResponse) {
    if (!payload || !payload.base64) {
        sendResponse({ success: false, error: 'base64 داده نشد' });
        return;
    }
    try {
        const text = await tryLocalOcr(payload.base64);
        if (text && text.trim().length > 5) {
            sendResponse({ success: true, text });
        } else {
            sendResponse({ success: false, error: 'متنی یافت نشد' });
        }
    } catch (err) {
        logger.error('handleOcrFileOnly error:', err);
        sendResponse({ success: false, error: err.message });
    }
}

// ===== Handler: انتظار برای دانلود بومی و ارسال آدرس آن به سرور پایتون =====
async function handleOcrNativeDownload(payload, sendResponse) {
    if (!payload || !payload.startTime) {
        sendResponse({ success: false, error: 'زمان شروع دانلود داده نشد' });
        return;
    }
    logger.info('⏳ Waiting for native download to complete...', new Date(payload.startTime).toISOString());
    
    // جستجوی دوره‌ای تا زمانی که دانلود تمام شود
    const maxTries = 30; // حداکثر ۳۰ ثانیه
    let tries = 0;
    
    const checkInterval = setInterval(async () => {
        tries++;
        try {
            const dls = await chrome.downloads.search({ 
                orderBy: ['-startTime'], 
                limit: 10 
            });
            
            // پیدا کردن جدیدترین دانلودی که بعد از startTime ما شروع شده
            const targetDl = dls.find(d => new Date(d.startTime).getTime() >= payload.startTime - 2000);
            
            if (targetDl) {
                if (targetDl.state === 'complete') {
                    clearInterval(checkInterval);
                    logger.info(`✅ Native download complete: ${targetDl.filename}`);
                    
                    // ارسال آدرس فایل محلی به سرور OCR پایتون
                    const LOCAL_OCR_URL = 'http://127.0.0.1:5151/ocr';
                    try {
                        const res = await fetch(LOCAL_OCR_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ file_path: targetDl.filename })
                        });
                        const data = await res.json();
                        if (data.success && data.text && data.text.trim().length > 10) {
                            logger.info(`✅ Local path OCR موفق: ${data.text.length} کاراکتر`);
                            sendResponse({ success: true, text: data.text });
                            
                            // حذف فایل دانلود شده
                            try {
                                await chrome.downloads.removeFile(targetDl.id);
                                logger.info(`🗑️ Deleted downloaded file: ${targetDl.filename}`);
                            } catch(e) {
                                logger.warn('Failed to delete file:', e.message);
                            }
                        } else {
                            sendResponse({ success: false, error: data.error || 'متنی یافت نشد' });
                        }
                    } catch (err) {
                        logger.error('Local OCR via path failed:', err.message);
                        sendResponse({ success: false, error: err.message });
                    }
                } else if (targetDl.state === 'interrupted') {
                    clearInterval(checkInterval);
                    logger.warn('❌ Native download interrupted');
                    sendResponse({ success: false, error: 'دانلود لغو شد یا با خطا مواجه شد' });
                }
            } else if (tries >= maxTries) {
                clearInterval(checkInterval);
                logger.warn('❌ Native download timeout');
                sendResponse({ success: false, error: 'دانلود در ۳۰ ثانیه پیدا/تکمیل نشد' });
            }
        } catch(e) {
            clearInterval(checkInterval);
            logger.error('chrome.downloads error:', e);
            sendResponse({ success: false, error: e.message });
        }
    }, 1000);
}

// ===== Handler: فقط OCR یک فایل (بدون AI) =====
async function handleOcrFileOnly(payload, sendResponse) {
    if (!payload || !payload.base64) {
        sendResponse({ success: false, error: 'base64 داده نشد' });
        return;
    }
    try {
        const text = await tryLocalOcr(payload.base64);
        if (text && text.trim().length > 5) {
            sendResponse({ success: true, text });
        } else {
            sendResponse({ success: false, error: 'متنی یافت نشد' });
        }
    } catch (err) {
        logger.error('handleOcrFileOnly error:', err);
        sendResponse({ success: false, error: err.message });
    }
}

// ===== Handler: OCR با base64 که content.js دانلود کرده =====
async function handleOcrWithBase64(payload, sendResponse) {
    if (!payload || (!payload.base64 && !payload.rawText)) {
        sendResponse({ success: false, error: 'base64 یا rawText داده نشد' });
        return;
    }
    try {
        if (!currentConfig) await loadConfig();
        
        let localText = payload.rawText || null;
        
        if (!localText && payload.base64) {
            localText = await tryLocalOcr(payload.base64);
        }
        
        if (!localText || localText.trim().length < 10) {
            sendResponse({ success: false, error: 'OCR محلی ناموفق بود (متنی یافت نشد)' });
            return;
        }
        
        // Truncate to avoid excessive token usage, but allow enough for most documents
        let truncatedText = localText;
        if (truncatedText.length > 15000) {
            truncatedText = truncatedText.substring(0, 15000) + '\n...[متن کوتاه شد]...';
        }
        
        logger.info('✅ ocrWithBase64 text length:', localText.length, 'Truncated to:', truncatedText.length);
        const structured = await analyzeTextOnly(truncatedText, payload.baseData || {});
        if (!structured) {
            sendResponse({ success: false, error: 'خطا در آنالیز ساختار نامه' });
            return;
        }
        structured.rawText = localText;
        applyAddressBookMatch(structured, payload.baseData || {});
        sendResponse({ success: true, data: structured });
    } catch (err) {
        logger.error('handleOcrWithBase64 error:', err);
        sendResponse({ success: false, error: err.message });
    }
}

// ===== Handler: دریافت فایل به صورت Base64 =====
async function handleFetchFileAsBase64(payload, sendResponse) {
    if (!payload || !payload.url) {
        sendResponse({ success: false, error: 'URL دریافت نشد' });
        return;
    }
    try {
        logger.info('Fetching file to Base64:', payload.url);
        const imgRes = await fetch(payload.url, {
            credentials: 'include',
            headers: { 'Accept': '*/*' }
        });
        if (!imgRes.ok) throw new Error(`Fetch ${imgRes.status}: ${imgRes.statusText}`);
        const buf = await imgRes.arrayBuffer();
        const bytes = new Uint8Array(buf);

        let bin = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.byteLength; i += chunk) {
            bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.byteLength)));
        }
        const b64 = btoa(bin);
        const finalDataUrl = `data:application/octet-stream;base64,${b64}`;
        sendResponse({ success: true, dataUrl: finalDataUrl });
    } catch (err) {
        logger.error('handleFetchFileAsBase64 error:', err);
        sendResponse({ success: false, error: err.message });
    }
}

// ===== Handler: OCR چند فایل و ترکیب متن =====
async function handleOcrAndAnalyzeMultiple(payload, sendResponse) {
    if (!payload || !payload.files || !payload.files.length) {
        sendResponse({ success: false, error: 'لیست فایل‌ها خالی است' });
        return;
    }
    try {
        if (!currentConfig) await loadConfig();
        
        let allExtractedText = '';
        logger.info(`Starting multi-file OCR for ${payload.files.length} files...`);

        for (let i = 0; i < payload.files.length; i++) {
            const file = payload.files[i];
            if (!file.base64) continue;
            
            logger.info(`Processing file ${i+1}/${payload.files.length}: ${file.label || 'Unknown'}`);
            try {
                // tryLocalOcr accepts base64 data URL
                const localText = await tryLocalOcr(file.base64);
                if (localText && localText.trim().length > 10) {
                    allExtractedText += `\n\n--- [${file.label || 'فایل ' + (i+1)}] ---\n${localText}`;
                } else {
                    logger.warn(`No text extracted for file ${file.label}`);
                }
            } catch (ocrErr) {
                logger.error(`OCR failed for file ${file.label}:`, ocrErr);
            }
        }

        if (allExtractedText.trim().length < 10) {
            sendResponse({ success: false, error: 'متنی از هیچ یک از فایل‌ها استخراج نشد' });
            return;
        }

        let truncatedText = allExtractedText;
        if (truncatedText.length > 25000) {
            truncatedText = truncatedText.substring(0, 25000) + '\n...[متن کوتاه شد]...';
        }

        logger.info('✅ Multiple files OCR complete. Total text length:', truncatedText.length);
        const structured = await analyzeTextOnly(truncatedText, payload.baseData || {});
        
        if (!structured) {
            sendResponse({ success: false, error: 'خطا در آنالیز ساختار نامه' });
            return;
        }
        
        structured.rawText = allExtractedText;
        applyAddressBookMatch(structured, payload.baseData || {});
        sendResponse({ success: true, data: structured });

    } catch (err) {
        logger.error('handleOcrAndAnalyzeMultiple error:', err);
        sendResponse({ success: false, error: err.message });
    }
}

// ===== Handler: OCR تصویر + آنالیز (دو مرحله‌ای) =====
async function handleOcrAndAnalyze(payload, sendResponse) {
    if (!payload) {
        sendResponse({ success: false, error: 'داده دریافت نشد' });
        return;
    }

    try {
        if (!currentConfig) await loadConfig();

        let rawText = '';

        // === مرحله ۱: استخراج متن خام (از DOM/PDF یا تصویر) ===
        if (payload.extractedText && payload.extractedText.trim().length > 50) {
            logger.info('Using pre-extracted text, length:', payload.extractedText.length);
            rawText = payload.extractedText;
        } else if (payload.imageUrl) {
            logger.info('Processing file, url prefix:', payload.imageUrl.substring(0, 80));

            let finalDataUrl = null;

            if (payload.imageUrl.startsWith('data:')) {
                // already a data URI
                finalDataUrl = payload.imageUrl;
                logger.info('Using data URI directly, length:', payload.imageUrl.length);
            } else {
                // دریافت فایل از URL سایت (با cookie برای احراز هویت)
                try {
                    logger.info('Fetching file from URL with credentials...');
                    const imgRes = await fetch(payload.imageUrl, {
                        credentials: 'include',
                        headers: { 'Accept': '*/*' }
                    });
                    if (!imgRes.ok) throw new Error(`Fetch ${imgRes.status}: ${imgRes.statusText}`);
                    const buf = await imgRes.arrayBuffer();
                    const bytes = new Uint8Array(buf);

                    // تبدیل به base64 (بدون تعیین MIME - سرور خودش نوع را تشخیص می‌دهد)
                    let bin = '';
                    const chunk = 8192;
                    for (let i = 0; i < bytes.byteLength; i += chunk) {
                        bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.byteLength)));
                    }
                    const b64 = btoa(bin);
                    finalDataUrl = `data:application/octet-stream;base64,${b64}`;
                    logger.info(`Fetched: ${(buf.byteLength / 1024).toFixed(1)} KB, sending to local OCR`);
                } catch (fetchErr) {
                    logger.error('File fetch failed:', fetchErr);
                    sendResponse({ success: false, error: 'خطا در دریافت فایل نامه: ' + fetchErr.message });
                    return;
                }
            }

            // ارسال به سرور OCR محلی
            const localText = await tryLocalOcr(finalDataUrl);
            if (localText) {
                logger.info('✅ Local OCR succeeded, length:', localText.length);
                rawText = localText;
            } else {
                sendResponse({ success: false, error: 'OCR محلی ناموفق بود (سرور در دسترس نیست یا متنی یافت نشد)' });
                return;
            }

        } else {
            sendResponse({ success: false, error: 'آدرس تصویر یا متن کافی دریافت نشد' });
            return;
        }

        logger.info('=====================================');
        logger.info('RAW OCR TEXT EXTRACTED:');
        logger.info(rawText);
        logger.info('=====================================');

        // === مرحله ۲: آنالیز متن استخراج‌شده با مدل متنی ===
        logger.info('Sending text to text-model for analysis...');
        const structured = await analyzeTextOnly(rawText, payload.baseData);
        logger.info('RAW STRUCTURED OUTPUT FROM LLM:', JSON.stringify(structured, null, 2));
        
        if (!structured) {
            sendResponse({ success: false, error: 'خطا در آنالیز ساختار نامه' });
            return;
        }

        structured.rawText = rawText; // ارسال متن کامل به کلاینت برای فیلد توضیحات

        applyAddressBookMatch(structured, payload.baseData);
        logger.info('OCR + Analysis complete:', structured);
        sendResponse({ success: true, data: structured });

    } catch (err) {
        logger.error('handleOcrAndAnalyze error:', err);
        sendResponse({ success: false, error: err.message });
    }
}

// === تطبیق فرستنده با دفترچه آدرس و داده‌های پایه ===
function applyAddressBookMatch(structured, baseData) {
    if (structured.sender || structured.senderEmail) {
        const matched = matchSenderInBook(structured.sender, structured.senderEmail);
        if (matched) {
            structured.sender = matched.name;
            structured.senderEmail = matched.email;
        }
    }
    if ((!structured.sender || structured.sender.trim() === '') && baseData?.sender) {
        structured.sender = baseData.sender;
    }
}

// === استخراج متن خام با مدل Vision ===
async function runVisionOcr(imageBase64, mimeType) {
    const endpoint = currentConfig.visionEndpoint;
    const apiKey   = currentConfig.apiKey;
    const model    = currentConfig.visionModel || 'Gemini-3.1-Pro-Preview';

    const systemPrompt = `شما یک سیستم OCR متخصص برای نامه‌های اداری فارسی هستید.
وظیفه: تمام متن موجود در تصویر را دقیقاً استخراج کنید.
قوانین:
- تمام متن فارسی، عربی و لاتین را استخراج کنید
- فقط متن خوانده شده را خروجی دهید، هیچ توضیحی اضافه نکنید`;

    const body = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    { type: 'text', text: `متن این تصویر را استخراج کنید:` },
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
                ]
            }
        ],
        temperature: 0.1,
        max_tokens: 8192
    };

    const res = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': apiKey, 'Accept': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Vision API error: ${res.status} - ${errText.substring(0, 200)}`);
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    logger.info('Vision response length:', raw.length);
    return raw;
}

// === آنالیز فقط متن (بدون تصویر — ارزان‌تر) ===
async function analyzeTextOnly(text, baseData) {
    const textEndpoint = currentConfig.textEndpoint || currentConfig.visionEndpoint;
    const apiKey       = currentConfig.apiKey;
    const model        = currentConfig.textModel || currentConfig.visionModel;

    const isFully = baseData && baseData.isFullyFilled;
    const systemPrompt = `شما یک متخصص استخراج اطلاعات ساختاریافته از نامه‌های اداری فارسی هستید.
متن زیر از یک نامه اداری استخراج شده است (احتمالاً با غلط‌های املایی ناشی از OCR).
${isFully ? 'توجه: اطلاعات پایه پر شده است. وظیفه شما تصحیح موضوع، استخراج دقیق شماره از موضوع فعلی، و یافتن کلیدواژه‌ها (نام/کدملی) است.' : 'وظیفه: اطلاعات خواسته‌شده را با بیشترین دقت استخراج کنید.'}

فرمت خروجی (فقط JSON):
{
  "originNo": "شماره نامه (از متن یا موضوع فعلی استخراج شود)",
  ${isFully ? '' : '"originDate": { "day": "روز", "month": "ماه", "year": "دو رقم آخر سال" },\n  "sender": "نام سازمان فرستنده",\n  "senderEmail": "ایمیل فرستنده",'}
  "subject": "موضوع تصحیح شده نامه (اگر موضوع فعلی حاوی شماره است، آن را حذف کنید و موضوع واقعی را بر اساس متن بنویسید)",
  "description": "متن کامل نامه را غلط‌گیری کرده و به زبان فارسی روان، رسمی و خوانا بازنویسی کنید",
  "keywords": "کلمات کلیدی مهم (حتماً نام تمام اشخاص، کدملی، شماره پرسنلی، نام سازمان و موضوعات اصلی را بنویسید) جدا شده با ویرگول"
}
قوانین:
- فقط JSON خروجی بده
- در کلیدواژه‌ها کدملی و نام افراد اولویت بالایی دارند.`;

    const baseInfo = baseData ? `\nموضوع فعلی: ${baseData.subject || '-'}\nاطلاعات موجود: فرستنده=${baseData.sender || '-'}, ایمیل=${baseData.senderEmail || '-'}` : '';

    const body = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `متن نامه:\n${text}${baseInfo}` }
        ],
        temperature: 0.1,
        max_tokens: 2000
    };

    const res = await fetchWithRetry(textEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': apiKey, 'Accept': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Text API error: ${res.status}`);
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '';
    const parsed = parseJSONResponse(raw);
    
    // اگر AI متنی برای توضیحات استخراج نکرد، مستقیم متن OCR را بگذار
    if (parsed && (!parsed.description || parsed.description.trim().length < 10)) {
        parsed.description = text;
    }
    
    return parsed;
}

function parseJSONResponse(text) {
    // تلاش مستقیم
    try { const d = JSON.parse(text.trim()); if (d && typeof d === 'object') return d; } catch (e) {}
    // جستجو در متن
    try { const m = text.match(/\{[\s\S]*\}/); if (m) { const d = JSON.parse(m[0]); if (d) return d; } } catch (e) {}
    // پاکسازی markdown
    try { const d = JSON.parse(text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()); if (d) return d; } catch (e) {}
    return null;
}

// ===== Handler: آنالیز تصویر نامه با AI Vision =====
async function handleAnalyzeLetter(payload, sendResponse) {
    if (!payload || !payload.imageUrl) {
        sendResponse({ success: false, error: 'آدرس تصویر نامه دریافت نشد' });
        return;
    }

    try {
        if (!currentConfig) await loadConfig();

        logger.info('Analyzing letter image:', payload.imageUrl.substring(0, 80) + '...');

        // دریافت تصویر به صورت base64
        let imageBase64 = null;
        let imageMimeType = 'image/jpeg';

        try {
            const imgResponse = await fetch(payload.imageUrl, {
                credentials: 'include',
                headers: { 'Accept': 'image/*' }
            });
            if (!imgResponse.ok) throw new Error(`Image fetch failed: ${imgResponse.status}`);
            const blob = await imgResponse.blob();
            imageMimeType = blob.type || 'image/jpeg';
            const arrayBuffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            imageBase64 = btoa(binary);
            logger.info('Image fetched, size:', arrayBuffer.byteLength);
        } catch (imgErr) {
            logger.error('Image fetch error:', imgErr);
            // اگر fetch مستقیم نشد، URL رو به مدل بده
            imageBase64 = null;
        }

        const systemPrompt = `شما یک متخصص استخراج اطلاعات از نامه‌های اداری فارسی هستید.

وظیفه: اطلاعات زیر را از تصویر نامه استخراج کنید و فقط در فرمت JSON برگردانید.

فرمت خروجی (دقیقاً همین ساختار JSON، بدون هیچ متن اضافه):
{
  "originNo": "شماره نامه (اگر نبود: خالی)",
  "originDate": {
    "day": "روز به عدد دو رقمی (مثال: 07)",
    "month": "ماه به عدد دو رقمی (مثال: 04)",
    "year": "دو رقم آخر سال شمسی (مثال: 05 برای 1405)"
  },
  "sender": "نام کامل سازمان فرستنده (فقط نام سازمان، بدون سمت یا نام فرد)",
  "senderEmail": "ایمیل فرستنده اگر در نامه موجود است (وگرنه خالی)",
  "subject": "موضوع نامه (دقیق و کامل)",
  "description": "خلاصه کوتاه محتوای نامه در یک یا دو جمله",
  "keywords": "کلمات کلیدی مهم (حتماً شامل نام شخص، کدملی اگر وجود دارد، نام سازمان، و موضوعات اصلی نامه) جدا شده با ویرگول"
}

قوانین مهم:
- اگر اطلاعاتی در نامه نبود، رشته خالی برگردان
- تاریخ را به عدد فارسی تبدیل نکن، فقط عدد لاتین
- در بخش کلیدواژه‌ها بسیار دقت کنید: اگر نام شخص، کد ملی، شماره پرسنلی، نام شرکت یا سازمان خاصی در نامه ذکر شده، حتماً آن‌ها را در کلیدواژه‌ها قرار دهید تا در جستجوها پیدا شوند.
- فقط JSON خروجی بده، هیچ توضیح یا متن دیگری ننویس`;

        const userContent = imageBase64
            ? [
                {
                    type: 'text',
                    text: 'لطفاً اطلاعات این نامه اداری را استخراج کنید:'
                },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:${imageMimeType};base64,${imageBase64}`
                    }
                }
            ]
            : [
                {
                    type: 'text',
                    text: `لطفاً اطلاعات نامه اداری موجود در این آدرس را استخراج کنید:\n${payload.imageUrl}`
                }
            ];

        const endpoint = currentConfig.visionEndpoint;
        const apiKey = currentConfig.apiKey;
        const modelName = currentConfig.visionModel || 'Gemini-3.1-Pro-Preview';

        logger.info('Calling Vision API:', modelName);

        const requestBody = {
            model: modelName,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            temperature: 0.1,
            max_tokens: 1000
        };

        const response = await fetchWithRetry(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': apiKey,
                'Accept': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        const rawText = data.choices?.[0]?.message?.content || '';
        logger.info('AI Response received, length:', rawText.length);

        // استخراج JSON از پاسخ
        const extracted = parseAIResponse(rawText);
        if (!extracted) {
            throw new Error('خطا در پارس JSON پاسخ AI: ' + rawText.substring(0, 300));
        }

        // تطبیق فرستنده با دفترچه آدرس
        if (extracted.sender || extracted.senderEmail) {
            const matched = matchSenderInBook(extracted.sender, extracted.senderEmail);
            if (matched) {
                extracted.senderMatched = matched.name;
                extracted.senderEmailMatched = matched.email;
            }
        }

        logger.info('Letter analyzed successfully:', extracted);
        sendResponse({ success: true, data: extracted });

    } catch (err) {
        logger.error('handleAnalyzeLetter error:', err);
        sendResponse({ success: false, error: err.message || 'خطا در آنالیز نامه' });
    }
}

// ===== پارس JSON از پاسخ AI =====
function parseAIResponse(text) {
    try {
        // تلاش مستقیم
        const direct = JSON.parse(text.trim());
        if (direct && typeof direct === 'object') return direct;
    } catch (e) {}

    try {
        // جستجوی JSON در متن
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (e) {}

    try {
        // پاکسازی markdown code blocks
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) {}

    return null;
}

// ===== تطبیق فرستنده با دفترچه آدرس =====
function matchSenderInBook(senderName, senderEmail) {
    if (!addressBook || addressBook.length === 0) return null;

    // تطبیق بر اساس ایمیل (دقیق)
    if (senderEmail && senderEmail.trim()) {
        const emailLower = senderEmail.toLowerCase().trim();
        const byEmail = addressBook.find(e => e.email && e.email.toLowerCase().trim() === emailLower);
        if (byEmail) {
            logger.info('Sender matched by email:', byEmail.name);
            return byEmail;
        }
    }

    // تطبیق بر اساس نام (جزئی)
    if (senderName && senderName.trim()) {
        const nameLower = normalizeArabic(senderName.toLowerCase().trim());
        
        // ابتدا تطبیق کامل
        const exactMatch = addressBook.find(e => 
            normalizeArabic(e.name.toLowerCase()) === nameLower
        );
        if (exactMatch) {
            logger.info('Sender matched exactly:', exactMatch.name);
            return exactMatch;
        }

        // تطبیق جزئی - آدرس‌بوک شامل نام AI
        const partialInBook = addressBook.find(e => {
            const bookName = normalizeArabic(e.name.toLowerCase());
            return bookName.includes(nameLower) || nameLower.includes(bookName);
        });
        if (partialInBook) {
            logger.info('Sender matched partially (book includes AI name):', partialInBook.name);
            return partialInBook;
        }

        // تطبیق کلمه به کلمه - حداقل ۲ کلمه مشترک
        const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
        if (nameWords.length > 0) {
            let bestMatch = null;
            let bestScore = 0;
            for (const entry of addressBook) {
                const entryWords = normalizeArabic(entry.name.toLowerCase()).split(/\s+/).filter(w => w.length > 2);
                const commonWords = nameWords.filter(w => entryWords.some(ew => ew.includes(w) || w.includes(ew)));
                const score = commonWords.length / Math.max(nameWords.length, entryWords.length);
                if (score > bestScore && score >= 0.4) {
                    bestScore = score;
                    bestMatch = entry;
                }
            }
            if (bestMatch) {
                logger.info(`Sender word-matched (score ${bestScore.toFixed(2)}):`, bestMatch.name);
                return bestMatch;
            }
        }
    }

    return null;
}

// ===== نرمال‌سازی عربی/فارسی =====
function normalizeArabic(str) {
    if (!str) return '';
    return str
        .replace(/ك/g, 'ک')
        .replace(/ي/g, 'ی')
        .replace(/ة/g, 'ه')
        .replace(/أ|إ|آ|ا/g, 'ا')
        .replace(/\s+/g, ' ')
        .trim();
}

// ===== Handler: تطبیق فرستنده =====
function handleMatchSender(payload, sendResponse) {
    if (!payload) {
        sendResponse({ success: false, error: 'داده ارسال نشد' });
        return;
    }
    const matched = matchSenderInBook(payload.name, payload.email);
    sendResponse({ success: true, data: matched });
}

// ===== Handler: دریافت Config =====
async function handleGetConfig(sendResponse) {
    if (!currentConfig) await loadConfig();
    sendResponse({ success: true, data: currentConfig });
}

// ===== Handler: ذخیره Config =====
async function handleSaveConfig(payload, sendResponse) {
    try {
        currentConfig = { ...currentConfig, ...payload };
        await chrome.storage.local.set({ autoimport_config: currentConfig });
        sendResponse({ success: true });
    } catch (err) {
        sendResponse({ success: false, error: err.message });
    }
}

// ===== Handler: ریلود دفترچه آدرس =====
async function handleReloadAddressBook(sendResponse) {
    try {
        await loadAddressBook();
        sendResponse({ success: true, count: addressBook.length });
    } catch (err) {
        sendResponse({ success: false, error: err.message });
    }
}

// ===== Handler: ذخیره دفترچه آدرس =====
async function handleSaveAddressBook(payload, sendResponse) {
    try {
        if (!Array.isArray(payload)) {
            sendResponse({ success: false, error: 'داده نامعتبر' });
            return;
        }
        addressBook = payload;
        await chrome.storage.local.set({ address_book: addressBook });
        sendResponse({ success: true, count: addressBook.length });
    } catch (err) {
        sendResponse({ success: false, error: err.message });
    }
}

// ===== Fetch با Retry =====
async function fetchWithRetry(url, options, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            if (i === retries) throw error;
            if (error.name === 'TypeError' || error.name === 'AbortError') {
                logger.warn(`Retry ${i + 1}/${retries}`);
                await new Promise(r => setTimeout(r, 1500 * (i + 1)));
                continue;
            }
            throw error;
        }
    }
}

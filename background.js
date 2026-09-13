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
            // ارتقای پیش‌فرض مدل متنی به مدل محلی قدرتمند Qwen 3.5 35B روی LM Studio
            const isLocalVision = currentConfig.visionModel && (currentConfig.visionModel.includes('qwen') || currentConfig.visionModel.includes('localQwen'));
            const isCloudText = !currentConfig.textModel || currentConfig.textModel === 'GPT-OSS-120B' || currentConfig.textModel === 'GPT-5-Mini' || (currentConfig.textEndpoint && currentConfig.textEndpoint.includes('arvancloudai.ir'));
            if (isLocalVision || isCloudText) {
                currentConfig.textModel = isLocalVision ? currentConfig.visionModel : 'qwen3.5-35b-a3b';
                currentConfig.textEndpoint = 'http://127.0.0.1:1234/api/v1/chat';
                await chrome.storage.local.set({ autoimport_config: currentConfig });
                logger.info('Migrated textModel to local qwen (LM Studio) in storage');
            }
            if (!currentConfig.endpoints) currentConfig.endpoints = {};
            let endpointsUpdated = false;
            if (!currentConfig.endpoints.localQwen35) {
                currentConfig.endpoints.localQwen35 = 'http://127.0.0.1:1234/api/v1/chat';
                endpointsUpdated = true;
            }
            if (!currentConfig.endpoints.localQwen27) {
                currentConfig.endpoints.localQwen27 = 'http://127.0.0.1:1234/api/v1/chat';
                endpointsUpdated = true;
            }
            if (endpointsUpdated) {
                await chrome.storage.local.set({ autoimport_config: currentConfig });
                logger.info('Added local Qwen endpoints to stored config');
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
    if (request.action === 'registerFormTab') {
        activeRegistrationTabId = sender.tab?.id || null;
        logger.info('Registered active registration form tabId:', activeRegistrationTabId);
        sendResponse({ success: true, tabId: activeRegistrationTabId });
        return true;
    }
    if (request.action === 'batchNextSignal') {
        handleBatchNextSignal(sendResponse);
        return true;
    }
    if (request.action === 'startOcrServerNative') {
        handleStartOcrServerNative(sendResponse);
        return true;
    }
    if (request.action === 'checkOcrServerStatus') {
        handleCheckOcrServerStatus(sendResponse);
        return true;
    }
    if (request.action === 'checkLmStudioStatus') {
        handleCheckLmStudioStatus(sendResponse);
        return true;
    }
});

let activeRegistrationTabId = null;

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    try {
        const isFormTab = (tabId === activeRegistrationTabId);
        const stored = await chrome.storage.local.get(['autoimport_batch_active', 'autoimport_batch_waiting']);
        
        if (stored.autoimport_batch_active && stored.autoimport_batch_waiting && (isFormTab || !activeRegistrationTabId)) {
            logger.info(`Tab ${tabId} was closed (form tab: ${isFormTab}). Clearing wait state and advancing batch queue...`);
            activeRegistrationTabId = null;
            await chrome.storage.local.set({
                autoimport_batch_waiting: false,
                autoimport_batch_next: Date.now()
            });
            const tabs = await chrome.tabs.query({});
            for (const t of tabs) {
                if (t.id) {
                    chrome.tabs.sendMessage(t.id, { action: 'triggerNextBatchItem' }).catch(() => {});
                }
            }
        } else if (isFormTab) {
            activeRegistrationTabId = null;
        }
    } catch (e) {
        logger.error('Error in chrome.tabs.onRemoved:', e);
    }
});

async function handleCheckLmStudioStatus(sendResponse) {
    try {
        const baseUrl = await findLmStudioBaseUrl();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`${baseUrl}/api/v1/models`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            const loaded = [];
            for (const m of (data.models || [])) {
                for (const inst of (m.loaded_instances || [])) {
                    const id = inst.id || inst.model_key;
                    if (id) loaded.push(id);
                }
            }
            sendResponse({ running: true, baseUrl, loadedModels: loaded });
        } else {
            sendResponse({ running: false, baseUrl });
        }
    } catch (e) {
        sendResponse({ running: false, error: e.message });
    }
}

async function handleCheckOcrServerStatus(sendResponse) {
    try {
        const settings = await chrome.storage.local.get(['autoimport_ocr_server']);
        const baseUrl = (settings.autoimport_ocr_server || 'http://127.0.0.1:5151').replace(/\/+$/, '');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const healthRes = await fetch(`${baseUrl}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        sendResponse({ running: healthRes.ok });
    } catch (e) {
        sendResponse({ running: false });
    }
}

async function handleStartOcrServerNative(sendResponse) {
    try {
        const settings = await chrome.storage.local.get(['autoimport_ocr_server']);
        const baseUrl = (settings.autoimport_ocr_server || 'http://127.0.0.1:5151').replace(/\/+$/, '');
        let isCurrentlyRunning = false;

        try {
            const healthRes = await Promise.race([
                fetch(`${baseUrl}/health`),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
            ]);
            isCurrentlyRunning = healthRes.ok;
        } catch (e) {
            isCurrentlyRunning = false;
        }

        const targetAction = isCurrentlyRunning ? 'stop' : 'start';

        if (chrome.runtime.sendNativeMessage) {
            chrome.runtime.sendNativeMessage('com.autoimport.ocr_launcher', { action: targetAction }, (response) => {
                if (chrome.runtime.lastError) {
                    logger.warn('Native messaging failed:', chrome.runtime.lastError.message, 'Extension ID:', chrome.runtime.id);
                    sendResponse({
                        success: false,
                        needSetup: true,
                        extId: chrome.runtime.id,
                        error: `راه انداز لایو فعال نیست (${chrome.runtime.lastError.message}).`
                    });
                } else {
                    logger.info('Native launcher response:', response);
                    sendResponse({
                        success: true,
                        running: targetAction === 'start',
                        message: response?.message || (targetAction === 'start' ? 'سرور OCR روشن شد.' : 'سرور OCR خاموش شد.')
                    });
                }
            });
        } else {
            sendResponse({ success: false, error: 'مرورگر از Native Messaging پشتیبانی نمی‌کند.' });
        }
    } catch (err) {
        sendResponse({ success: false, error: err.message });
    }
}

async function handleBatchNextSignal(sendResponse) {
    try {
        logger.info('Received batchNextSignal. Updating storage and notifying all tabs...');
        activeRegistrationTabId = null;
        await chrome.storage.local.set({
            autoimport_batch_next: Date.now(),
            autoimport_batch_waiting: false
        });

        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
            if (t.id) {
                chrome.tabs.sendMessage(t.id, { action: 'triggerNextBatchItem' }).catch(() => {});
            }
        }
        sendResponse({ success: true });
    } catch (e) {
        logger.error('handleBatchNextSignal error:', e);
        sendResponse({ success: false, error: e.message });
    }
}

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
    const settings = await chrome.storage.local.get(['autoimport_ocr_server']);
    const baseUrl = (settings.autoimport_ocr_server || 'http://127.0.0.1:5151').replace(/\/+$/, '');
    const LOCAL_OCR_URL = `${baseUrl}/ocr`;
    const LOCAL_HEALTH_URL = `${baseUrl}/health`;

    try {
        // بررسی آیا سرور محلی در دسترس است
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const healthCheck = await fetch(LOCAL_HEALTH_URL, { signal: controller.signal });
        clearTimeout(timeoutId);
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
        const ocrController = new AbortController();
        const ocrTimeout = setTimeout(() => ocrController.abort(), 120000);
        const res = await fetch(LOCAL_OCR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imageUrl }),
            signal: ocrController.signal
        });
        clearTimeout(ocrTimeout);
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
    const maxTries = 60; // حداکثر ۶۰ ثانیه
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
                    const settings = await chrome.storage.local.get(['autoimport_ocr_server']);
                    const baseUrl = (settings.autoimport_ocr_server || 'http://127.0.0.1:5151').replace(/\/+$/, '');
                    const LOCAL_OCR_URL = `${baseUrl}/ocr`;
                    try {
                        const ocrCtrl = new AbortController();
                        const ocrT = setTimeout(() => ocrCtrl.abort(), 120000);
                        const res = await fetch(LOCAL_OCR_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ file_path: targetDl.filename }),
                            signal: ocrCtrl.signal
                        });
                        clearTimeout(ocrT);
                        const data = await res.json();
                        if (data.success && data.text && data.text.trim().length > 3) {
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
                sendResponse({ success: false, error: 'دانلود در ۶۰ ثانیه پیدا/تکمیل نشد' });
            }
        } catch(e) {
            clearInterval(checkInterval);
            logger.error('chrome.downloads error:', e);
            sendResponse({ success: false, error: e.message });
        }
    }, 1000);
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
        if (payload.extractedText && payload.extractedText.trim().length > 5) {
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
        let keepAliveTimer = setInterval(() => {
            chrome.storage.local.get(['_keepalive'], () => {});
        }, 4000);

        let structured = null;
        try {
            structured = await analyzeTextOnly(rawText, payload.baseData);
        } finally {
            clearInterval(keepAliveTimer);
        }

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

// ===== LM Studio Local Model Helper Functions =====

function isLocalEndpoint(url = '', modelName = '') {
    const sUrl = String(url || '').toLowerCase();
    const sModel = String(modelName || '').toLowerCase();
    return sUrl.includes('127.0.0.1') ||
           sUrl.includes('localhost') ||
           sUrl.includes('192.168.') ||
           sUrl.includes(':1234') ||
           sModel.includes('qwen') ||
           sModel.includes('localqwen') ||
           sModel.includes('local_qwen');
}

function getLocalModelName(model = '') {
    const m = String(model || '').toLowerCase();
    if (m.includes('27b') || m.includes('localqwen27')) {
        return 'qwen3.8-27b@iq2_s';
    }
    return 'qwen3.5-35b-a3b';
}

function getLmStudioBaseUrl(endpoint = '') {
    const s = String(endpoint || '');
    const match = s.match(/^(https?:\/\/[^\/]+)/);
    if (match) return match[1];
    return 'http://127.0.0.1:1234';
}

let _activeLmStudioBaseUrl = null;

async function findLmStudioBaseUrl(preferredEndpoint = null) {
    const candidates = [];
    if (preferredEndpoint) {
        const preferredBase = getLmStudioBaseUrl(preferredEndpoint);
        if (preferredBase && !candidates.includes(preferredBase)) {
            candidates.push(preferredBase);
        }
    }
    if (_activeLmStudioBaseUrl && !candidates.includes(_activeLmStudioBaseUrl)) {
        candidates.push(_activeLmStudioBaseUrl);
    }
    const defaults = [
        'http://127.0.0.1:1234',
        'http://192.168.88.251:1234',
        'http://localhost:1234'
    ];
    for (const d of defaults) {
        if (!candidates.includes(d)) candidates.push(d);
    }

    for (const candidate of candidates) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(`${candidate}/api/v1/models`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                _activeLmStudioBaseUrl = candidate;
                logger.info(`🎯 آدرس فعال LM Studio شناسایی شد: ${candidate}`);
                return candidate;
            }
        } catch (e) {
            // بررسی گزینه بعدی
        }
    }

    return candidates[0] || 'http://127.0.0.1:1234';
}

async function unloadLocalModel(endpoint = null, modelName = null) {
    try {
        const baseUrl = await findLmStudioBaseUrl(endpoint);
        const unloadUrl = `${baseUrl}/api/v1/models/unload`;
        const modelsUrl = `${baseUrl}/api/v1/models`;

        const targetIds = [];
        if (modelName) targetIds.push(modelName);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const rModels = await fetch(modelsUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (rModels.ok) {
                const data = await rModels.json();
                for (const m of (data.models || [])) {
                    for (const inst of (m.loaded_instances || [])) {
                        const instId = inst.id || inst.model_key;
                        if (instId && !targetIds.includes(instId)) {
                            targetIds.push(instId);
                        }
                    }
                }
            }
        } catch (e) {
            // ignore
        }

        for (const instId of targetIds) {
            try {
                const res = await fetch(unloadUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ instance_id: instId })
                });
                if (res.ok) {
                    logger.info(`🧹 مدل محلی ${instId} با موفقیت از رم آف‌لود (Unload) شد.`);
                }
            } catch (e) {
                logger.warn(`خطا در آف‌لود مدل ${instId}:`, e.message);
            }
        }
    } catch (err) {
        logger.warn('خطا در عملیات unloadLocalModel:', err.message);
    }
}

async function ensureLocalModelLoaded(endpoint = null, modelName = null, contextLength = 13000) {
    try {
        const baseUrl = await findLmStudioBaseUrl(endpoint);
        const loadUrl = `${baseUrl}/api/v1/models/load`;
        const modelsUrl = `${baseUrl}/api/v1/models`;

        const targetModel = getLocalModelName(modelName);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const rModels = await fetch(modelsUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (rModels.ok) {
                const data = await rModels.json();
                for (const m of (data.models || [])) {
                    for (const inst of (m.loaded_instances || [])) {
                        const instId = inst.id || inst.model_key;
                        if (instId === targetModel) {
                            logger.info(`⚡ مدل محلی ${targetModel} از قبل روی ${baseUrl} لود است.`);
                            return true;
                        }
                    }
                }
            }
        } catch (e) {
            logger.warn(`بررسی وضعیت مدل‌های LM Studio روی ${baseUrl} با تاخیر یا خطا مواجه شد؛ ارسال مستقیم به استنتاج:`, e.message);
            return true;
        }

        logger.info(`⏳ در حال لود مدل محلی ${targetModel} روی ${baseUrl} با کانتکست ${contextLength} (parallel=1)...`);
        const loadController = new AbortController();
        const loadTimeoutId = setTimeout(() => loadController.abort(), 90000);

        try {
            const loadRes = await fetch(loadUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: targetModel,
                    context_length: contextLength,
                    parallel: 1
                }),
                signal: loadController.signal
            });
            clearTimeout(loadTimeoutId);

            if (loadRes.ok) {
                logger.info(`✅ مدل محلی ${targetModel} با موفقیت لود شد.`);
                return true;
            } else {
                const errText = await loadRes.text();
                logger.warn(`نتیجه لود ${targetModel}: ${loadRes.status} - ${errText.substring(0, 200)}`);
                return false;
            }
        } catch (loadErr) {
            clearTimeout(loadTimeoutId);
            logger.warn(`خطا یا اتمام مهلت در لود مدل روی ${baseUrl}:`, loadErr.message);
            return true;
        }
    } catch (err) {
        logger.warn('خطا در ensureLocalModelLoaded:', err.message);
        return true;
    }
}

function toEnglishDigits(str) {
    if (!str) return '';
    const persian = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const arabic  = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    let res = String(str).normalize('NFKD')
        .replace(/ي/g, 'ی')
        .replace(/ك/g, 'ک')
        .replace(/ة/g, 'ه');
    for (let i = 0; i < 10; i++) {
        res = res.replaceAll(persian[i], String(i)).replaceAll(arabic[i], String(i));
    }
    return res;
}

function isNormalYear(s) {
    if (!/^\d{3,4}$/.test(s)) return false;
    const n = parseInt(s, 10);
    if (s.length === 3) return n >= 400 && n <= 409;
    return n >= 1370 && n <= 1420;
}

function isReversedYear(s) {
    if (!/^\d{3,4}$/.test(s)) return false;
    const rev = s.split('').reverse().join('');
    const n = parseInt(rev, 10);
    if (s.length === 3) return n >= 400 && n <= 409;
    return n >= 1370 && n <= 1420;
}

function isDateString(val) {
    if (!val) return false;
    const str = toEnglishDigits(String(val)).trim().replace(/[\u200E\u200F\s]/g, '');
    if (/^1[34]\d{2}[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])$/.test(str)) return true;
    if (/^(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.]1[34]\d{2}$/.test(str)) return true;
    if (/^0[0-9][\/\-\.](0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])$/.test(str)) return true;
    return false;
}

function getCurrentJalaliDate() {
    try {
        const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        let y = '1405', m = '06', d = '22';
        for (const p of parts) {
            if (p.type === 'year') y = p.value;
            if (p.type === 'month') m = p.value;
            if (p.type === 'day') d = p.value;
        }
        const fullYear = y.length === 4 ? y : ('14' + y.slice(-2));
        const shortYear = fullYear.slice(-2);
        return { year: shortYear, fullYear, shortYear, month: m, day: d };
    } catch (e) {
        return { year: '05', fullYear: '1405', shortYear: '05', month: '06', day: '22' };
    }
}

function ensureValidPastOrPresentDate(dt, curJalali = getCurrentJalaliDate()) {
    if (!dt) return null;
    let rawY = dt.year != null ? toEnglishDigits(String(dt.year)).trim() : '';
    let rawM = dt.month != null ? toEnglishDigits(String(dt.month)).trim() : '';
    let rawD = dt.day != null ? toEnglishDigits(String(dt.day)).trim() : '';

    let y = parseInt(rawY, 10);
    let m = parseInt(rawM, 10);
    let d = parseInt(rawD, 10);

    if (isNaN(y) || isNaN(m) || isNaN(d)) return dt;

    let shortY = y >= 1000 ? (y % 100) : y;
    const curFullY = parseInt(curJalali.fullYear || '1405', 10);
    const curShortY = curFullY % 100;
    const curM = parseInt(curJalali.month, 10);
    const curD = parseInt(curJalali.day, 10);

    const isAfterToday = (testY, testM, testD) => {
        if (testY > curShortY) return true;
        if (testY === curShortY && testM > curM) return true;
        if (testY === curShortY && testM === curM && testD > curD) return true;
        return false;
    };

    if (isAfterToday(shortY, m, d)) {
        logger.warn(`⚠️ تاریخ استخراج‌شده (${d}/${m}/${shortY}) بزرگتر از تاریخ امروز (${curD}/${curM}/${curShortY}) است. در حال تصحیح هوشمند...`);

        // ۱. بررسی خطای جابجایی ماه و روز (مثلاً OCR ماه را 12 و روز را 06 خوانده باشد)
        if (m > curM && d <= 12 && m <= 31) {
            const swappedM = d;
            const swappedD = m;
            if (!isAfterToday(shortY, swappedM, swappedD) && swappedM >= 1 && swappedM <= 12 && swappedD >= 1 && swappedD <= 31) {
                logger.info(`🔄 اصلاح جابجایی ماه و روز: ${d}/${m}/${shortY} -> ${swappedD}/${swappedM}/${shortY}`);
                m = swappedM;
                d = swappedD;
            }
        }

        // ۲. تصحیح سال در صورتی که سال در آینده تشخیص داده شده باشد (مثلاً 06 به جای 05)
        if (shortY > curShortY && (shortY - curShortY) <= 2) {
            if (!isAfterToday(curShortY, m, d)) {
                logger.info(`🔄 اصلاح خطای OCR سال: تغییر سال ${shortY} به ${curShortY}`);
                shortY = curShortY;
            }
        }

        // ۳. اگر ماه همچنان بعد از ماه جاری است (و در سال جاری قرار دارد)
        if (shortY === curShortY && m > curM) {
            logger.info(`🔄 اصلاح ماه آینده: تغییر ماه ${m} به ماه جاری ${curM}`);
            m = curM;
            if (d > curD) d = curD;
        }

        // ۴. اگر در سال و ماه جاری، روز جلوتر از امروز است
        if (shortY === curShortY && m === curM && d > curD) {
            logger.info(`🔄 اصلاح روز آینده: محدودسازی روز ${d} به روز جاری ${curD}`);
            d = curD;
        }

        // ۵. اگر سال همچنان در آینده است
        if (shortY > curShortY) {
            shortY = curShortY;
            if (m > curM) {
                m = curM;
                if (d > curD) d = curD;
            }
        }
    }

    if (m < 1) m = 1;
    if (m > 12) m = 12;
    if (d < 1) d = 1;
    if (d > 31) d = 31;

    return {
        day: String(d).padStart(2, '0'),
        month: String(m).padStart(2, '0'),
        year: String(shortY).padStart(2, '0')
    };
}

function isReversedTwoDigitCode(s) {
    if (!/^\d{2}$/.test(s)) return false;
    const rev = s.split('').reverse().join('');
    const nOrig = parseInt(s, 10);
    const nRev = parseInt(rev, 10);
    // کدهای ۲ رقمی اداری که بر اثر خوانش راست‌به‌چپ وارونه شده‌اند (مثل 61 -> 16)
    return nOrig > 40 && nRev <= 40;
}

function isValidOriginNoCandidate(str) {
    if (!str) return false;
    const s = toEnglishDigits(String(str)).trim();
    // الزماً باید شامل حداقل یک رقم انگلیسی باشد
    if (!/\d/.test(s)) return false;
    // نباید برچسب سازمان/فرستنده/موضوع/متن/صندوق باشد
    if (/^(?:سازمان|فرستنده|موضوع|صندوق|گیرنده|متن|دریافت|پست|email)\b/i.test(s) ||
        s.includes('فرستنده:') || s.includes('سازمان فرستنده') || s.includes('دریافت شده')) {
        return false;
    }
    if (isDateString(s)) return false;
    return true;
}

function normalizeLetterNumber(rawNo) {
    if (!rawNo) return '';
    let str = toEnglishDigits(String(rawNo))
        .replace(/^(شماره\s*نامه|شماره\s*مدرک|شماره\s*وارده|شماره|موضوع\s*نامه|موضوع|ثماره|no\.?|letter\s*no\.?)\s*[:؛-]?\s*/i, '')
        .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .replace(/[\(\)\[\]\{\}]/g, '')
        .replace(/[\\؍]/g, '/')
        .replace(/\s*\/\s*/g, '/')
        .replace(/[-_]+$/, '')
        .trim();

    if (!isValidOriginNoCandidate(str)) return '';

    // اصلاح شماره‌های بلند قضایی/اداری (۱۵ تا ۲۰ رقم پیوسته مانند ۱۴۰۵۰۹۹۹۰۰۲۵۴۷۱۱۶۳)
    // اگر در OCR سال اول آن به صورت 120x یا 130x خوانده شده باشد:
    if (/^1[23]0[3-6]\d{12,16}$/.test(str)) {
        str = '140' + str.substring(3);
    }

    // استخراج پسوند حروفی اداری در انتهای شماره (مانند "1405 ص"، "/ص"، "-ص"، "_ص")
    let suffix = '';
    const cleanSuffix = (s) => s.trim().replace(/[-_]+/g, '').replace(/\s+/g, ' ');

    const suffixMatch = str.match(/[\s\/\-_]+([a-zA-Z\u0600-\u06FF\s]{1,10})$/);
    if (suffixMatch) {
        suffix = cleanSuffix(suffixMatch[1]);
        str = str.substring(0, suffixMatch.index).trim();
    }

    // استخراج پیشوند حروفی در ابتدای شماره (مانند "ص/1405/...")
    const prefixMatch = str.match(/^([a-zA-Z\u0600-\u06FF\s]{1,10})[\s\/\-_]+/);
    if (!suffix && prefixMatch) {
        suffix = cleanSuffix(prefixMatch[1]);
        str = str.substring(prefixMatch[0].length).trim();
    }

    // اگر با خط تیره به جای اسلش تفکیک شده بود
    if (!str.includes('/') && str.includes('-')) {
        const dashParts = str.split('-');
        if (dashParts.length >= 2 && dashParts.some(p => isNormalYear(p) || isReversedYear(p))) {
            str = dashParts.join('/');
        }
    }

    if (!str.includes('/')) {
        if (isReversedYear(str)) {
            str = str.split('').reverse().join('');
        }
        if (str.length === 3 && str.startsWith('40')) str = '1' + str;
        return suffix ? `${str}/${suffix}` : str;
    }

    let parts = str.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return suffix ? suffix : str;

    // بررسی مجدد اگر پسوند هنوز درون آخرین یا اولین پارت باشد
    if (!suffix && parts.length > 1 && /^[a-zA-Z\u0600-\u06FF\s\-_]{1,10}$/.test(parts[parts.length - 1])) {
        suffix = cleanSuffix(parts.pop());
    } else if (!suffix && parts.length > 1 && /^[a-zA-Z\u0600-\u06FF\s\-_]{1,10}$/.test(parts[0])) {
        suffix = cleanSuffix(parts.shift());
    }

    // شناسایی و اصلاح سال‌های معکوس ۴ رقمی (مانند 5041 معکوس 1405)
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '5041' || parts[i] === '5040' || parts[i] === '5031') {
            parts[i] = parts[i].split('').reverse().join('');
            for (let j = 0; j < parts.length; j++) {
                if (j !== i && /^\d+$/.test(parts[j])) {
                    if (parts[j].startsWith('0') || isReversedTwoDigitCode(parts[j])) {
                        parts[j] = parts[j].split('').reverse().join('');
                    }
                }
            }
            break;
        }
    }

    // یافتن پارت سال شمسی
    let yearIdx = -1;
    let yearIsReversed = false;

    for (let i = 0; i < parts.length; i++) {
        if (isNormalYear(parts[i])) {
            yearIdx = i;
            yearIsReversed = false;
            break;
        } else if (isReversedYear(parts[i])) {
            yearIdx = i;
            yearIsReversed = true;
            break;
        }
    }

    if (yearIdx !== -1) {
        if (yearIsReversed) {
            parts[yearIdx] = parts[yearIdx].split('').reverse().join('');
        }
        if (parts[yearIdx].length === 3 && parts[yearIdx].startsWith('40')) {
            parts[yearIdx] = '1' + parts[yearIdx];
        }

        // اگر سال در انتهای رشته بود (مثال: ۵۶/۴۴/۱۸۳۸۴/۱۴۰۵)، نشانه این است که کل عبارت
        // در فرم راست‌به‌چپ تایپ شده و موتور OCR آن را چپ‌به‌راست خوانده است؛
        // بنابراین کل اجزا باید معکوس شوند تا ترتیب استاندارد اداری حاصل گردد (1405/18384/44/56)
        if (yearIdx === parts.length - 1 && parts.length > 1) {
            parts.reverse();
        } else if (yearIdx !== 0) {
            // سال در وسط بود؛ سال را به ابتدای شماره می‌آوریم
            const yVal = parts[yearIdx];
            const others = parts.filter((_, idx) => idx !== yearIdx);
            parts = [yVal, ...others];
        }
    }

    // اصلاح کدهای ۲ رقمی معکوس (مثلاً 61 -> 16) اگر سال نیز وارونه بوده باشد
    if (yearIsReversed) {
        for (let i = 0; i < parts.length; i++) {
            if (isReversedTwoDigitCode(parts[i])) {
                parts[i] = parts[i].split('').reverse().join('');
            }
        }
    }

    let result = parts.join('/');
    if (suffix) {
        result += '/' + suffix;
    }
    return result;
}

// --- استخراج مستقیم شماره رسمی نامه از هدر سند (<PRIMARY_DOCUMENT_HEADER>) ---
function extractHeaderOriginNo(rawText) {
    if (!rawText) return '';
    const enRaw = toEnglishDigits(rawText);
    let headerSection = '';
    const headerMatch = enRaw.match(/<PRIMARY_DOCUMENT_HEADER>([\s\S]*?)<\/PRIMARY_DOCUMENT_HEADER>/i);
    if (headerMatch) headerSection = headerMatch[1];

    // اگر متن هدر مربوط به کاور ایمیل فرزین باشد، هدر سند اصلی نیست
    if (headerSection.includes('دریافت شده در این صندوق') || headerSection.includes('سرور پست الکترونیکی') || headerSection.includes('EmailLayout')) {
        headerSection = '';
    }

    const lines = (headerSection ? headerSection.split('\n') : enRaw.split('\n'))
        .map(l => l.trim()).filter(Boolean);

    // ۱. اولویت ۱: خط دارای برچسب صریح "شماره نامه" یا "شماره صادره" یا "شماره وارده" یا "شماره مدرک"
    for (let i = 0; i < Math.min(lines.length, 35); i++) {
        const line = lines[i];
        const match = line.match(/(?:شماره\s*نامه|شماره\s*صادره|شماره\s*وارده|شماره\s*مدرک|letter\s*no\.?)\s*[:؛-]?\s*([^\n\r]+)/i);
        if (match) {
            let cand = match[1].trim();
            if (cand && !cand.startsWith('شماره') && isValidOriginNoCandidate(cand)) {
                const norm = normalizeLetterNumber(cand);
                if (norm && isValidOriginNoCandidate(norm)) return norm;
            }
        }
    }

    // ۲. کدهای طولانی پیوسته قضایی/ثنا در هدر (۱۵ تا ۲۰ رقم بدون اسلش که با 140x یا 120x شروع شوند)
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const line = lines[i];
        if (isDateString(line) || line.includes('تاريخ') || line.includes('تاریخ') || line.includes('پرونده') || line.includes('بایگانی')) continue;
        const longNumMatch = line.match(/\b(1[24]0\d{12,16})\b/);
        if (longNumMatch) {
            const norm = normalizeLetterNumber(longNumMatch[1]);
            if (norm && isValidOriginNoCandidate(norm)) return norm;
        }
    }

    // ۳. کدهای اداری اسلش‌دار حاوی 140x یا 40x در هدر
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const line = lines[i];
        if (isDateString(line) || line.includes('تاريخ') || line.includes('تاریخ') || line.includes('پرونده') || line.includes('بایگانی')) continue;
        const codeMatch = line.match(/\b([a-zA-Z\u0600-\u06FF0-9]{1,6}[\/\-](?:140[0-9]|40[0-9])[\/\-][a-zA-Z\u0600-\u06FF0-9]{1,10})\b/) ||
                          line.match(/\b((?:140[0-9]|40[0-9])[\/\-][a-zA-Z\u0600-\u06FF0-9]{1,10}[\/\-][a-zA-Z\u0600-\u06FF0-9]{1,6})\b/) ||
                          line.match(/\b([a-zA-Z\u0600-\u06FF0-9]{1,6}[\/\-][a-zA-Z\u0600-\u06FF0-9]{1,6}[\/\-][a-zA-Z\u0600-\u06FF0-9]{1,10}[\/\-](?:140[0-9]|40[0-9]))\b/);
        if (codeMatch) {
            const norm = normalizeLetterNumber(codeMatch[1]);
            if (norm && isValidOriginNoCandidate(norm)) return norm;
        }
    }

    // ۴. برچسب عمومی "شماره:" در خطوط هدر (به استثنای شماره پرونده و شماره بایگانی)
    for (let i = 0; i < Math.min(lines.length, 35); i++) {
        const line = lines[i];
        if (line.includes('پرونده') || line.includes('بایگانی') || line.includes('پلاک') || line.includes('کلاسه')) continue;
        const match = line.match(/(?:شماره|ثماره|no\.?)\s*[:؛-]?\s*([^\n\r]+)/i);
        if (match) {
            let cand = match[1].trim();
            if (cand && isValidOriginNoCandidate(cand)) {
                const norm = normalizeLetterNumber(cand);
                if (norm && isValidOriginNoCandidate(norm)) return norm;
            }
        }
    }

    // ۵. شماره‌های معکوس مانند 0663/5041/ف ا یا 5041/0663/ف ا در خطوط ابتدایی متن
    for (let i = 0; i < Math.min(lines.length, 25); i++) {
        const line = lines[i];
        if (isDateString(line) || line.includes('تاريخ') || line.includes('تاریخ')) continue;
        const revMatch = line.match(/(\d{2,7})[\/\\](50[345]1)[\/\\]([a-zA-Z\u0600-\u06FF\s]+)/) ||
                         line.match(/(50[345]1)[\/\\](\d{2,7})[\/\\]([a-zA-Z\u0600-\u06FF\s]+)/);
        if (revMatch) {
            const yr = (revMatch[2] === '5041' || revMatch[1] === '5041' ? '1405' : '1404');
            const ser = (revMatch[1] === '5041' ? revMatch[2] : revMatch[1]).split('').reverse().join('');
            const suf = revMatch[3].trim();
            const norm = normalizeLetterNumber(`${yr}/${ser}/${suf}`);
            if (norm && isValidOriginNoCandidate(norm)) return norm;
        }
    }

    return '';
}

function normalizeExtractedLetterData(parsed, rawText = '', baseData = {}) {
    if (!parsed || typeof parsed !== 'object') return parsed;

    // ۱. استخراج مستقیم و قطعی شماره نامه از بخش هدر سند (<PRIMARY_DOCUMENT_HEADER>)
    const headerOriginNo = extractHeaderOriginNo(rawText);
    let originNo = parsed.originNo != null ? String(parsed.originNo) : '';
    originNo = normalizeLetterNumber(originNo);

    // گارد حیاتی: شماره نامه هرگز نباید تاریخ باشد!
    if (originNo && isDateString(originNo)) {
        logger.warn(`⚠️ شماره نامه (${originNo}) به اشتباه برابر تاریخ بود! در حال ابطال و استخراج شماره واقعی...`);
        originNo = '';
    }

    // اولویت ۱۰۰٪ شماره نامه با هدر رسمی سند است
    // اگر هدر سند صراحتاً شماره نامه دارد (مانند شماره قضایی 140509990025471163 یا اداری 1405/18384/44/56/ص)،
    // نباید با شماره‌های پرونده یا کدهای موجود در موضوع ایمیل (مانند 1405/7068/10) اشتباه شود یا جایگزین گردد
    if (headerOriginNo) {
        if (!originNo || originNo !== headerOriginNo) {
            logger.info(`🔄 اولویت رسمی شماره نامه هدر سند: جایگزینی شماره '${originNo || 'ناموجود'}' با شماره قطعی هدر '${headerOriginNo}'`);
            originNo = headerOriginNo;
        }
    }

    // اگر در هدر شماره نامه پیدا نشد، تلاش برای تطبیق با موضوع یا شماره مدرک به عنوان آخرین راهکار:
    if (!originNo || originNo.includes('ندارد') || originNo.includes('یافت نشد') || isDateString(originNo)) {
        originNo = '';

        // استخراج شماره سریال یا شماره نامه از موضوع (baseData.subject) جهت انطباق
        let subjectSerial = '';
        if (baseData && baseData.subject) {
            const enSub = toEnglishDigits(baseData.subject);
            const labeledMatch = enSub.match(/(?:شماره|ثماره|no\.?|letter\s*no\.?)\s*[:؛-]?\s*([a-zA-Z\u0600-\u06FF0-9\/\-_]+)/i);
            if (labeledMatch && !isDateString(labeledMatch[1])) {
                subjectSerial = labeledMatch[1].trim();
            } else {
                const numMatches = enSub.match(/\b\d{4,7}\b/g);
                if (numMatches) {
                    for (const num of numMatches) {
                        const n = parseInt(num, 10);
                        if (n < 1370 || n > 1420) {
                            subjectSerial = num;
                            break;
                        }
                    }
                }
            }
        }

        if (subjectSerial && rawText) {
            const cleanSerial = subjectSerial.replace(/[-_\s]+/g, '');
            const enRaw = toEnglishDigits(rawText);
            const lines = enRaw.split('\n').map(l => l.trim()).filter(Boolean);
            for (let i = 0; i < Math.min(lines.length, 35); i++) {
                const line = lines[i];
                if (line.includes(cleanSerial) && !isDateString(line) && isValidOriginNoCandidate(line)) {
                    const candNo = normalizeLetterNumber(line);
                    if (candNo && !isDateString(candNo) && isValidOriginNoCandidate(candNo)) {
                        logger.info(`✅ انطباق شماره نامه با موضوع انجام شد: ${candNo}`);
                        originNo = candNo;
                        break;
                    }
                }
            }
        }

        // اولویت ثانویه: شماره از شماره مدرک دریافتی
        if (!originNo && baseData && baseData.documentNumber) {
            const docCand = normalizeLetterNumber(baseData.documentNumber);
            if (docCand && !isDateString(docCand)) originNo = docCand;
        }

        // اولویت نهایی: استخراج شماره از موضوع
        if (!originNo && baseData && baseData.subject) {
            const subMatch = toEnglishDigits(baseData.subject).match(/\b(\d{2,}[\d\/\-]{2,}\d+(?:\s*[\/\-]\s*[a-zA-Z\u0600-\u06FF\s]{1,6})?)\b/);
            if (subMatch && !isDateString(subMatch[1])) {
                const candSub = normalizeLetterNumber(subMatch[1]);
                if (candSub && isValidOriginNoCandidate(candSub)) {
                    originNo = candSub;
                }
            }
        }
    }

    parsed.originNo = originNo ? normalizeLetterNumber(originNo) : '';

    // ۲. پاکسازی، نرمال‌سازی و اعتبارسنجی تاریخ نامه (originDate)
    const headerDate = extractDateFromText(rawText);
    let originDate = parsed.originDate;

    if (typeof originDate === 'string') {
        originDate = parseDateCandidate(toEnglishDigits(originDate));
    } else if (originDate && typeof originDate === 'object') {
        let day = originDate.day != null ? toEnglishDigits(String(originDate.day).trim()) : '';
        let month = originDate.month != null ? toEnglishDigits(String(originDate.month).trim()) : '';
        let year = originDate.year != null ? toEnglishDigits(String(originDate.year).trim()) : '';

        const dStr = `${year}/${month}/${day}`;
        originDate = parseDateCandidate(dStr);
    }

    // اصلاح خطای OCR در خواندن ماه ۰۶ (شهریور) به ۰۲ (اردیبهشت)
    const currentJalali = getCurrentJalaliDate();
    const baseMonth = baseData?.originDate?.month ? parseInt(toEnglishDigits(String(baseData.originDate.month)), 10) : null;
    const sysMonth = parseInt(currentJalali.month, 10);

    const fixMonthConfusion = (dt) => {
        if (!dt) return dt;
        const m = parseInt(dt.month, 10);
        if (m === 2 && (baseMonth === 6 || sysMonth === 6)) {
            logger.info(`🔄 اصلاح خطای OCR ماه: تغییر ماه 02 به 06 (شهریور) برای تاریخ ${dt.day}/${dt.month}/${dt.year}`);
            dt.month = '06';
        }
        return dt;
    };

    if (originDate) originDate = fixMonthConfusion(originDate);
    if (headerDate) fixMonthConfusion(headerDate);

    // تضمین اکید عدم ثبت تاریخ در آینده و اصلاح هوشمند خطاهای OCR
    if (originDate) originDate = ensureValidPastOrPresentDate(originDate, currentJalali);
    if (headerDate) headerDate = ensureValidPastOrPresentDate(headerDate, currentJalali);

    // اولویت ۱۰۰٪ تاریخ با هدر بالای نامه (<PRIMARY_DOCUMENT_HEADER>) است
    // تا از توهم مدل هوش مصنوعی یا برداشت تاریخ از متن پیوست و عطف نامه‌ها ممانعت شود
    if (headerDate) {
        if (!originDate || originDate.day !== headerDate.day || originDate.month !== headerDate.month || originDate.year !== headerDate.year) {
            logger.info(`🔄 اولویت رسمی تاریخ هدر سند: جایگزینی تاریخ ${originDate ? originDate.day + '/' + originDate.month + '/' + originDate.year : 'ناموجود'} با تاریخ قطعی هدر (${headerDate.day}/${headerDate.month}/${headerDate.year})`);
            originDate = headerDate;
        }
    }

    // اعتبارسنجی ارقام روز و ماه
    if (!originDate || parseInt(originDate.month, 10) > 12 || parseInt(originDate.day, 10) > 31 || parseInt(originDate.day, 10) === 0 || parseInt(originDate.month, 10) === 0) {
        if (headerDate) originDate = headerDate;
        else if (baseData && baseData.originDate) originDate = baseData.originDate;
    }

    let finalDate = originDate || headerDate || baseData?.originDate || null;
    if (finalDate) {
        finalDate = ensureValidPastOrPresentDate(finalDate, currentJalali);
    }
    parsed.originDate = finalDate;
    return parsed;
}

// --- استخراج تاریخ معتبر از متن هدر سند (به ویژه تگ <PRIMARY_DOCUMENT_HEADER> و خروجی Apple Vision) ---
function extractDateFromText(rawText) {
    if (!rawText) return null;
    const enText = toEnglishDigits(rawText);

    // ۱. بررسی درون تگ <PRIMARY_DOCUMENT_HEADER>
    let headerText = '';
    const headerMatch = enText.match(/<PRIMARY_DOCUMENT_HEADER>([\s\S]*?)<\/PRIMARY_DOCUMENT_HEADER>/i);
    if (headerMatch) {
        headerText = headerMatch[1];
    }

    // اگر متن هدر مربوط به کاور ایمیل فرزین باشد، هدر سند اصلی نیست
    if (headerText.includes('دریافت شده در این صندوق') || headerText.includes('سرور پست الکترونیکی') || headerText.includes('EmailLayout')) {
        headerText = '';
    }

    const searchLinesForDate = (lines) => {
        // الف) خطوط دارای برچسب 'تاریخ' یا 'تاريخ'
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('تاريخ') || line.includes('تاریخ') || line.toLowerCase().includes('date')) {
                const m = line.match(/(?:1[234]0\d)\s*[\/\-\.]\s*(?:0?[1-9]|1[0-2])\s*[\/\-\.]\s*(?:[12]\d|3[01]|0?[1-9])\b/) ||
                          line.match(/(?:[12]\d|3[01]|0?[1-9])\s*[\/\-\.]\s*(?:0?[1-9]|1[0-2])\s*[\/\-\.]\s*(?:1[234]0\d)\b/) ||
                          line.match(/(?:1[234]0\d|\d{2})\s*[\/\-\.]\s*(?:0?[1-9]|1[0-2])\s*[\/\-\.]\s*(?:0?[1-9]|[12]\d|3[01])/);
                if (m) {
                    const parsed = parseDateCandidate(m[0]);
                    if (parsed) return parsed;
                }

                // هدر عمودی (برچسب تاریخ در یک خط و مقدار در خطوط بعدی)
                for (let j = 1; j <= 5; j++) {
                    if (i + j < lines.length) {
                        const nextLine = lines[i + j];
                        const nextM = nextLine.match(/^(?:1[234]0\d)\s*[\/\-\.]\s*(?:0?[1-9]|1[0-2])\s*[\/\-\.]\s*(?:0?[1-9]|[12]\d|3[01])$/) ||
                                      nextLine.match(/^(?:0?[1-9]|[12]\d|3[01])\s*[\/\-\.]\s*(?:0?[1-9]|1[0-2])\s*[\/\-\.]\s*(?:1[234]0\d)$/);
                        if (nextM) {
                            const parsed = parseDateCandidate(nextM[0]);
                            if (parsed) return parsed;
                        }
                    }
                }
            }
        }

        // ب) تاریخ شمسی ۴ رقمی مستقل در خطوط هدر
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(/\b(1[234]0\d)\s*[\/\-\.]\s*(0?[1-9]|1[0-2])\s*[\/\-\.]\s*([12]\d|3[01]|0?[1-9])\b/) ||
                      line.match(/\b([12]\d|3[01]|0?[1-9])\s*[\/\-\.]\s*(0?[1-9]|1[0-2])\s*[\/\-\.]\s*(1[234]0\d)\b/);
            if (m) {
                const parsed = parseDateCandidate(m[0]);
                if (parsed) return parsed;
            }
        }

        // ج) تاریخ‌های معکوس مانند 12/60/5041 (که 5041 سال 1405، 60 ماه 06، و 12 روز 12 است)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const revDateMatch = line.match(/\b(\d{1,2})\s*[\/\-\.]\s*(0?[1-9]|60)\s*[\/\-\.]\s*(50[345]1)\b/);
            if (revDateMatch) {
                const d = revDateMatch[1].padStart(2, '0');
                const m = revDateMatch[2] === '60' ? '06' : revDateMatch[2].padStart(2, '0');
                const y = revDateMatch[3] === '5041' ? '05' : '04';
                return { day: d, month: m, year: y };
            }
        }
        return null;
    };

    // اولویت ۱: جستجو در تگ اختصاصی هدر
    if (headerText) {
        const hLines = headerText.split('\n').map(l => l.trim()).filter(Boolean);
        const res = searchLinesForDate(hLines);
        if (res) return res;
    }

    // اولویت ۲: جستجو در ۳۵ خط اول متن کل
    const allLines = enText.split('\n').map(l => l.trim()).filter(Boolean);
    const topLines = allLines.slice(0, 35);
    const res = searchLinesForDate(topLines);
    if (res) return res;

    // اولویت ۳: الگوی مورخ در کل متن
    const movarekhMatch = enText.match(/مورخ\s*[:؛-]?\s*(1[234]0\d)\s*[\/\-\.]\s*(0?[1-9]|1[0-2])\s*[\/\-\.]\s*(0?[1-9]|[12]\d|3[01])/);
    if (movarekhMatch) {
        const parsed = parseDateCandidate(movarekhMatch[0].replace(/مورخ\s*[:؛-]?\s*/, ''));
        if (parsed) return parsed;
    }

    return null;
}

function parseDateCandidate(str) {
    if (!str) return null;
    const parts = str.match(/\d+/g);
    if (!parts || parts.length < 3) return null;

    let y, m, d;
    if (parts[0].length === 4 || parts[0].startsWith('14') || parts[0].startsWith('13') || parts[0].startsWith('12')) {
        y = parts[0]; m = parts[1]; d = parts[2];
    } else if (parts[2].length === 4 || parts[2].startsWith('14') || parts[2].startsWith('13') || parts[2].startsWith('12')) {
        y = parts[2]; m = parts[1]; d = parts[0];
    } else {
        y = parts[0]; m = parts[1]; d = parts[2];
    }

    let numY = parseInt(y, 10);
    let numM = parseInt(m, 10);
    let numD = parseInt(d, 10);

    // اصلاح خطای OCR سال 120x یا 130x به 140x
    if (numY >= 1200 && numY <= 1299) {
        numY = (numY + 200) % 100;
    } else if (numY >= 1300) {
        numY = numY % 100;
    }

    // اصلاح جابجایی سال و روز: در حال حاضر سال‌های شمسی 00 تا 09 هستند و روزها تا 31
    if (numY > 10 && numD <= 9) {
        let tmp = numD; numD = numY; numY = tmp;
    }
    if (numD > 31 && numY <= 31) {
        let tmp = numD; numD = numY; numY = tmp;
    }
    if (numM > 12 && numD <= 12) {
        let tmp = numM; numM = numD; numD = tmp;
    }

    // اصلاح خطای OCR ماه 02 به 06 در فونت نستعلیق هنگامی که ماه جاری 06 است
    const curJalali = getCurrentJalaliDate();
    if (numM === 2 && parseInt(curJalali.month, 10) === 6 && (numY === 5 || numY === 1405 || numY === 4 || numY === 1404)) {
        numM = 6;
    }

    const candidate = {
        day: String(numD).padStart(2, '0'),
        month: String(numM).padStart(2, '0'),
        year: String(numY).padStart(2, '0')
    };
    return ensureValidPastOrPresentDate(candidate, curJalali);
}

// === آنالیز فقط متن (بدون تصویر — ارزان‌تر و سریع‌تر) ===
async function analyzeTextOnly(text, baseData) {
    let textEndpoint = currentConfig.textEndpoint || currentConfig.visionEndpoint;
    let apiKey       = currentConfig.apiKey;
    let model        = currentConfig.textModel || currentConfig.visionModel;

    // اگر در visionModel یا textModel یک مدل محلی (Qwen / LM Studio) ست شده باشد، اولویت قطعی با مدل محلی است
    if (isLocalEndpoint(currentConfig.visionEndpoint, currentConfig.visionModel)) {
        model = currentConfig.visionModel;
        textEndpoint = currentConfig.visionEndpoint;
    } else if (isLocalEndpoint(currentConfig.textEndpoint, currentConfig.textModel)) {
        model = currentConfig.textModel;
        textEndpoint = currentConfig.textEndpoint;
    }

    const isFully = baseData && baseData.isFullyFilled;
    const curJalali = getCurrentJalaliDate();
    const todayDateStr = `${curJalali.fullYear}/${curJalali.month}/${curJalali.day}`;

    const systemPrompt = `شما یک متخصص تحلیل و استخراج اطلاعات ساختاریافته از اسناد و مکاتبات اداری رسمی ایران هستید.
متن زیر از یک نامه اداری استخراج شده است که بخش هدر آن با تگ <PRIMARY_DOCUMENT_HEADER> مشخص گردیده است.
${isFully ? 'توجه: وظیفه شما تصحیح دقیق موضوع، استخراج شماره نامه و تاریخ از هدر سند، و یافتن کلیدواژه‌ها (نام/کدملی) است.' : 'وظیفه: اطلاعات خواسته‌شده را با بیشترین دقت، به‌ویژه در بخش شماره نامه و تاریخ، استخراج کنید.'}

فرمت خروجی (فقط و فقط یک آبجکت معتبر JSON):
{
  "originNo": "شماره دقیق نامه اداری",
  "originDate": { "day": "روز به عدد دو رقمی انگلیسی (01 تا 31)", "month": "ماه به عدد دو رقمی انگلیسی (01 تا 12)", "year": "دو رقم آخر سال به انگلیسی (مثلاً برای سال 1405 فقط 05 بنویسید)" },
  ${isFully ? '' : '"sender": "نام سازمان فرستنده",\n  "senderEmail": "ایمیل فرستنده",'}
  "subject": "موضوع تصحیح شده نامه (اگر موضوع فعلی حاوی شماره نامه است، آن شماره را از موضوع حذف کنید)",
  "description": "متن کامل نامه را غلط‌گیری کرده و به زبان فارسی، رسمی و خوانا بازنویسی کنید بدون تغییر در اصل نامه. عبارات تکراری، کلمات لوپ‌شده یا حاشیه‌های زاید را کاملاً پاک‌سازی کنید",
  "keywords": "کلمات کلیدی مهم شامل نام تمام اشخاص، کدملی، شماره پرسنلی، نام سازمان‌ها و موضوع اصلی جدا شده با ویرگول"
}

قوانین حیاتی و اکید:
۱. منبع استخراج شماره و تاریخ (<PRIMARY_DOCUMENT_HEADER>):
   - شماره نامه (originNo) و تاریخ نامه (originDate) را الزماً و ۱۰۰٪ فقط از بخش هدر بالای نامه (<PRIMARY_DOCUMENT_HEADER>) که برچسب‌های 'شماره' و 'تاریخ' دارد بردارید.
   - هشدار اکید: به هیچ عنوان تاریخ یا شماره را از متن پیوست‌ها، عطف به نامه‌های گذشته، پانویس‌ها، یا بدنه نامه بر ندارید!

۲. شماره نامه (originNo) و انطباق با موضوع (<SUBJECT_HINT>):
   - هشدار فوق‌العاده حیاتی: هرگز تاریخ نامه را در originNo قرار ندهید! فیلد originNo باید شماره نامه اداری باشد نه تاریخ!
   - نامه‌های قضایی / دادگستری / ثنا: در نامه‌های قضایی و ابلاغیه‌های دادگستری، شماره نامه یک عدد پیوسته ۱۶ تا ۱۸ رقمی بدون اسلش است که با ۱۴۰۵ یا ۱۴۰۴ یا ۱۴۰۳ شروع می‌شود و روبروی «شماره نامه:» در هدر سند قرار دارد (مانند ۱۴۰۵۰۹۹۹۰۰۲۵۴۷۱۱۶۳). این شماره را دقیقاً به صورت عدد کامل بدون اسلش استخراج کنید و هرگز آن را با «شماره پرونده» یا «شماره بایگانی» اشتباه نگیرید!
   - نامه‌های استاندارد اداری و دولتی (دارای اسلش): سال شمسی ۴ رقمی همیشه در ابتدای شماره (سمت چپ) قرار می‌گیرد و به دنبال آن شماره سریال و کدهای اداری و در انتها پسوند حروفی (مانند /ص یا /ح).
     مثال: عبارت هدر "۵۶/۴۴/۱۸۳۸۴/۱۴۰۵ ص" باید به صورت استاندارد چپ‌به‌راست "1405/18384/44/56/ص" ثبت شود نه معکوس!
   - در ۹۰ درصد موارد نامه‌های اداری، شماره نامه یا شماره سریال اصلی آن در موضوع ایمیل (<SUBJECT_HINT>) قید شده است (مانند ۱۸۳۸۴). شماره استخراج‌شده از هدر را حتماً با شماره یا کد موجود در <SUBJECT_HINT> تطبیق دهید (مگر در نامه‌های قضایی که شماره هدر ۱۸ رقمی مستقل و قطعی است).
   - توجه به سال ۳ رقمی: سال‌های ۳ رقمی (مانند ۴۰۵ یا 405) همان 1405 هستند و باید 1405 ثبت شوند.

۳. تاریخ نامه (originDate) و تقویم جاری امروز:
   - تاریخ رسمی امروز سیستم: ${todayDateStr} (سال شمسی: ${curJalali.fullYear}، ماه: ${curJalali.month}، روز: ${curJalali.day}) است.
   - هشدار فوق‌العاده حیاتی: تاریخ صدور یک نامه وارده اداری در گذشته یا حداکثر امروز است و هرگز نمی‌تواند بزرگتر از تاریخ امروز (${todayDateStr}) در آینده باشد!
   - تاریخ رسمی صدور فقط و فقط از بخش <PRIMARY_DOCUMENT_HEADER> استخراج شود.
   - اگر در OCR یا متن هدر، تاریخی خوانده شد که بعد از امروز است (مثلاً ماه بزرگتر از ${curJalali.month} یا روز بعد از امروز، یا سال بزرگتر)، این ناشی از خطای OCR، جابجایی ارقام ماه و روز (مانند خواندن ۱۲/۰۶ به جای ۰۶/۱۲) یا ناخوانایی ارقام است؛ با توجه به اینکه نامه حداکثر تا امروز (${todayDateStr}) صادر شده است، تاریخ واقعی را با تطبیق با تاریخ امروز حدس بزن و تصحیح کن و هرگز تاریخی در آینده خروجی نده.
   - سال‌های شمسی اداری جاری ایران 1403، 1404 یا 1405 هستند (دو رقم آخر: "03", "04", "05"). اگر در OCR سال 1205 آمده بود، خطای OCR است و "05" ثبت شود.
   - خطای فونت نستعلیق در ماه: اگر ماه 02 خوانده شده ولی ماه جاری شهریور (ماه 06) است، حتماً 06 ثبت شود.

۴. خروجی فقط و فقط JSON باشد بدون هیچ توضیح یا متنی قبل یا بعد از آن.`;

    // سقف‌گذاری هوشمند حجم متن برای حفاظت از پنجره زمینه (Context Window) مدل‌های محلی مانند Qwen
    let safeText = (text || '').trim();
    const MAX_ANALYSIS_CHARS = 20000;
    if (safeText.length > MAX_ANALYSIS_CHARS) {
        logger.warn(`⚠️ حجم کل متن نامه (${safeText.length} کاراکتر) بیش از گنجایش مدل است. در حال خلاصه‌سازی به ${MAX_ANALYSIS_CHARS} کاراکتر برای ارسال به هوش مصنوعی...`);
        const head = safeText.substring(0, 16000);
        const tail = safeText.substring(safeText.length - 3500);
        safeText = head + '\n\n... [ادامه متن پیوست‌های طولانی جهت جلوگیری از سرریز بافت مدل خلاصه شد] ...\n\n' + tail;
    }

    const baseInfo = baseData ? `
<METADATA_FROM_EMAIL_SYSTEM>
<SUBJECT_HINT>${baseData.subject || '-'}</SUBJECT_HINT>
<SENDER_HINT>${baseData.sender || '-'}</SENDER_HINT>
<EMAIL_HINT>${baseData.senderEmail || '-'}</EMAIL_HINT>
</METADATA_FROM_EMAIL_SYSTEM>` : '';

    const userPrompt = `اطلاعات سیستمی و متن نامه به شرح زیر است:
<CURRENT_DATE_CONTEXT>
تاریخ رسمی امروز سیستم: ${todayDateStr} (سال: ${curJalali.fullYear}، ماه: ${curJalali.month}، روز: ${curJalali.day})
توجه مهم: تاریخ نامه صدوریافته به هیچ وجه نباید در آینده (بزرگتر از ${todayDateStr}) باشد. در صورت مشاهده تاریخ آینده در OCR، تاریخ صحیح را حدس بزن و اصلاح کن.
</CURRENT_DATE_CONTEXT>
${baseInfo}

<DOCUMENT_CONTENT>
${safeText}
</DOCUMENT_CONTENT>`;

    const isLocal = isLocalEndpoint(textEndpoint, model);

    if (isLocal) {
        try {
            return await runLocalLmStudioAnalysis(systemPrompt, userPrompt, text, baseData, model);
        } catch (localErr) {
            logger.warn('خطا در اجرای مستقیم مدل محلی LM Studio:', localErr.message);
        }
    }

    // تلاش با مدل ابری یا استاندارد OpenAI
    try {
        const fallbackEndpoint = isLocal && textEndpoint.includes('/api/v1/chat')
            ? textEndpoint.replace('/api/v1/chat', '/v1/chat/completions')
            : textEndpoint;

        const authHeader = (isLocal || !apiKey) ? 'Bearer lm-studio' : apiKey;
        const targetModel = isLocal ? getLocalModelName(model) : model;

        const body = {
            model: targetModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            max_tokens: 3000
        };

        const res = await fetchWithRetry(fallbackEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader, 'Accept': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`Text API error: ${res.status}`);
        const data = await res.json();
        let raw = data.choices?.[0]?.message?.content || '';
        raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const parsed = parseJSONResponse(raw);
        if (!parsed) throw new Error('عدم امکان پارس پاسخ JSON مدل ابری');

        if (!parsed.description || parsed.description.trim().length < 10) {
            parsed.description = text;
        }

        return normalizeExtractedLetterData(parsed, text, baseData);
    } catch (cloudErr) {
        logger.warn(`⚠️ خطای پردازش (${cloudErr.message}). در حال انتقال خودکار و پردازش با مدل محلی LM Studio (Qwen)...`);
        return await runLocalLmStudioAnalysis(systemPrompt, userPrompt, text, baseData, 'qwen3.5-35b-a3b');
    }
}

async function runLocalLmStudioAnalysis(systemPrompt, userPrompt, text, baseData, modelName = 'qwen3.5-35b-a3b') {
    const localModelName = getLocalModelName(modelName);
    const preferredEndpoint = currentConfig?.textEndpoint || currentConfig?.visionEndpoint;
    const baseUrl = await findLmStudioBaseUrl(preferredEndpoint);

    logger.info(`🤖 آماده‌سازی مدل محلی LM Studio (${localModelName}) روی ${baseUrl}...`);
    await ensureLocalModelLoaded(baseUrl, localModelName, 13000);

    const nativePayload = {
        model: localModelName,
        input: `${systemPrompt}\n\n${userPrompt}`,
        temperature: 0.1,
        reasoning: "off",
        max_output_tokens: 3500
    };

    logger.info(`🤖 ارسال به اندپوینت نیتیو LM Studio (${baseUrl}/api/v1/chat) با مدل ${localModelName}...`);
    let raw = '';
    let success = false;

    // مهلت استنتاج طولانی (۱۸۰ ثانیه) برای نامه‌های حجیم
    const controller1 = new AbortController();
    const timeout1 = setTimeout(() => controller1.abort(), 180000);

    try {
        const res = await fetch(`${baseUrl}/api/v1/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nativePayload),
            signal: controller1.signal
        });
        clearTimeout(timeout1);

        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.output)) {
                for (const item of data.output) {
                    if (item && item.type === 'reasoning') continue;
                    if (typeof item === 'string') raw += item;
                    else if (item && item.content) raw += item.content;
                }
            } else if (typeof data.output === 'string') {
                raw = data.output;
            } else if (data.choices?.[0]?.message?.content) {
                raw = data.choices[0].message.content;
            }
            if (raw && raw.trim().length > 5) {
                success = true;
            }
        } else {
            const errText = await res.text();
            logger.warn(`پاسخ خطای /api/v1/chat (${res.status}): ${errText.substring(0, 100)}`);
        }
    } catch (apiErr) {
        clearTimeout(timeout1);
        logger.warn('خطا در فراخوانی /api/v1/chat:', apiErr.message);
    }

    // در صورت عدم موفقیت با اندپوینت نیتیو، تلاش ثانویه با اندپوینت OpenAI (/v1/chat/completions)
    if (!success) {
        logger.info(`🔄 در حال تلاش ثانویه با اندپوینت OpenAI (${baseUrl}/v1/chat/completions)...`);
        const openAiPayload = {
            model: localModelName,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            max_tokens: 3500
        };

        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 180000);

        try {
            const res2 = await fetch(`${baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(openAiPayload),
                signal: controller2.signal
            });
            clearTimeout(timeout2);

            if (res2.ok) {
                const data2 = await res2.json();
                raw = data2.choices?.[0]?.message?.content || '';
                if (!raw && data2.choices?.[0]?.message?.reasoning_content) {
                    raw = data2.choices[0].message.reasoning_content;
                }
            } else {
                const err2 = await res2.text();
                throw new Error(`خطای سرور LM Studio در هر دو اندپوینت: ${res2.status} - ${err2.substring(0, 100)}`);
            }
        } catch (openAiErr) {
            clearTimeout(timeout2);
            throw openAiErr;
        }
    }

    raw = (raw || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const parsed = parseJSONResponse(raw);
    if (!parsed) {
        throw new Error(`پارس JSON خروجی مدل محلی ناموفق بود: ${raw.substring(0, 150)}`);
    }

    if (!parsed.description || parsed.description.trim().length < 10) {
        parsed.description = text;
    }

    const normalized = normalizeExtractedLetterData(parsed, text, baseData);
    logger.info('✅ پاسخ مدل محلی LM Studio با موفقیت دریافت و فیلدها نرمال‌سازی شدند.');
    return normalized;
}

function parseJSONResponse(text) {
    if (!text) return null;
    let clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // ۱. تلاش مستقیم
    try { const d = JSON.parse(clean); if (d && typeof d === 'object') return d; } catch (e) {}

    // ۲. پاکسازی بلاک markdown
    const mdMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (mdMatch) {
        try { const d = JSON.parse(mdMatch[1].trim()); if (d && typeof d === 'object') return d; } catch (e) {}
        clean = mdMatch[1].trim();
    }

    // ۳. جستجوی کرلی براکت‌های ابتدا و انتها
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first !== -1 && last > first) {
        const sub = clean.substring(first, last + 1);
        try { const d = JSON.parse(sub); if (d && typeof d === 'object') return d; } catch (e) {}

        // اصلاح کامای اضافی قبل از بستن براکت
        const noTrailing = sub.replace(/,\s*([\}\]])/g, '$1');
        try { const d = JSON.parse(noTrailing); if (d && typeof d === 'object') return d; } catch (e) {}

        // اصلاح خطوط شکسته و کاراکترهای کنترلی درون رشته‌ها
        let inString = false;
        let escaped = false;
        let sb = '';
        for (let i = 0; i < noTrailing.length; i++) {
            const ch = noTrailing[i];
            if (ch === '"' && !escaped) {
                inString = !inString;
                sb += ch;
            } else if (inString) {
                if (ch === '\n') sb += '\\n';
                else if (ch === '\r') sb += '\\r';
                else if (ch === '\t') sb += '\\t';
                else sb += ch;
            } else {
                sb += ch;
            }
            escaped = (ch === '\\' && !escaped);
        }
        try { const d = JSON.parse(sb); if (d && typeof d === 'object') return d; } catch (e) {}
    }
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

        const endpoint = currentConfig.visionEndpoint;
        const modelName = currentConfig.visionModel || 'Gemini-3.1-Pro-Preview';

        // اگر مدل انتخاب‌شده محلی است (Qwen متنی)، ابتدا تصویر را با OCR محلی بخوان و سپس به مدل متنی بده
        if (isLocalEndpoint(endpoint, modelName)) {
            logger.info('Local model configured for letter analysis. Running local OCR first...');
            let dataUrl = payload.imageUrl;
            if (!dataUrl.startsWith('data:')) {
                try {
                    const imgRes = await fetch(payload.imageUrl, { credentials: 'include' });
                    if (imgRes.ok) {
                        const buf = await imgRes.arrayBuffer();
                        const bytes = new Uint8Array(buf);
                        let bin = '';
                        for (let i = 0; i < bytes.byteLength; i += 8192) {
                            bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.byteLength)));
                        }
                        dataUrl = `data:${imgRes.headers.get('content-type') || 'image/jpeg'};base64,${btoa(bin)}`;
                    }
                } catch (e) {
                    logger.warn('Failed to fetch image for local OCR:', e.message);
                }
            }
            const localText = await tryLocalOcr(dataUrl);
            if (localText && localText.trim().length > 10) {
                const structured = await analyzeTextOnly(localText, payload.baseData || {});
                if (structured) {
                    structured.rawText = localText;
                    applyAddressBookMatch(structured, payload.baseData || {});
                    sendResponse({ success: true, data: structured });
                    return;
                }
            }
        }

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

        const curJalali = getCurrentJalaliDate();
        const todayDateStr = `${curJalali.fullYear}/${curJalali.month}/${curJalali.day}`;

        const systemPrompt = `شما یک متخصص استخراج اطلاعات ساختاریافته از نامه‌های اداری فارسی هستید.

وظیفه: اطلاعات زیر را از تصویر نامه استخراج کنید و فقط در فرمت JSON برگردانید.

فرمت خروجی (فقط JSON):
{
  "originNo": "شماره دقیق نامه اداری",
  "originDate": { "day": "روز به دو رقم انگلیسی", "month": "ماه به دو رقم انگلیسی", "year": "دو رقم آخر سال به انگلیسی" },
  "sender": "نام سازمان فرستنده",
  "senderEmail": "ایمیل فرستنده",
  "subject": "موضوع تصحیح شده نامه (اگر موضوع فعلی حاوی شماره است، آن را حذف کنید و در بخش شماره بنویسید و موضوع واقعی را بر اساس متن بنویسید)",
  "description": "متن کامل نامه را غلط‌گیری کرده و به زبان فارسی، رسمی و خوانا بازنویسی کنید بدون تغییر در اصل نامه. اگر در متن اصلی جملات یا کاراکترهای تکراری و لوپ‌شده (مثل /۱/۱/۱/۱ یا -۴/۵-۴/۵ یا تکرار متوالی عبارات) وجود داشت، حتماً آن‌ها را پاک‌سازی و اصلاح کن تا متن نهایی کاملاً تمیز باشد",
  "keywords": "کلمات کلیدی مهم (حتماً نام تمام اشخاص که تو متن نامه آمده، کدملی، شماره پرسنلی، نام سازمان و موضوعات اصلی را بنویسید) جدا شده با ویرگول"
}

قوانین:
- فقط JSON خروجی بده
- شماره نامه (originNo): هرگز و تحت هیچ شرایطی تاریخ را در originNo ننویسید! در نامه‌های قضایی/دادگستری/ثنا شماره نامه یک عدد ۱۶ تا ۱۸ رقمی پیوسته بدون اسلش با شروع ۱۴۰۵... از روبروی «شماره نامه:» است (نه شماره پرونده یا بایگانی). در سایر نامه‌ها فرمت استاندارد اداری سال/کد/شماره یا سال/شماره/پسوند است (مثال: 1405/1556/ح یا 1405/16/4239). سال‌های ۳ رقمی مانند ۴۰۵ یا 405 همان 1405 هستند.
- تاریخ نامه (originDate): تاریخ امروز سیستم ${todayDateStr} است. تاریخ نامه یک نامه وارده هرگز نمی‌تواند در آینده (بزرگتر از ${todayDateStr}) باشد. تاریخ را فقط از متن هدر دریافت کن و از متن اصلی نامه تاریخی را وارد نکن. در صورت مشاهده تاریخ آینده به دلیل خطای خوانش OCR، تاریخ صحیح را با در نظر گرفتن تاریخ امروز حدس بزن و اصلاح کن. خطای فونت ۶ به ۲ در ماه شهریور (06 به جای 02) را اصلاح کن.
- از تکرار عبارات یا لوپ‌های کاراکتری پرهیز کن
- در کلیدواژه‌ها کدملی و نام افراد اولویت بالایی دارند
- اعداد انگلیسی باشن`;

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

        const apiKey = currentConfig.apiKey;

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

        const normalized = normalizeExtractedLetterData(extracted, rawText, payload.baseData);

        // تطبیق فرستنده با دفترچه آدرس
        if (normalized.sender || normalized.senderEmail) {
            const matched = matchSenderInBook(normalized.sender, normalized.senderEmail);
            if (matched) {
                normalized.senderMatched = matched.name;
                normalized.senderEmailMatched = matched.email;
            }
        }

        logger.info('Letter analyzed successfully:', normalized);
        sendResponse({ success: true, data: normalized });

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

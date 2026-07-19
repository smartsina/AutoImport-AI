// ===== AutoImport AI - Content Script (v2) =====
// جریان کار: لیست ایمیل → receivexml parsing → فرم وارده → پر کردن + ذخیره + ارجاع

// ===== تأیید خودکار دیالوگ‌ها: از طریق MAIN world در background.js انجام می‌شود =====
// (تزریق inline script به دلیل CSP سایت بلاک می‌شود؛ به جای آن از MutationObserver استفاده می‌کنیم)

const aiLogger = {
    info:  (msg, data = null) => console.log(`[AutoImport CS] ${msg}`, data || ''),
    error: (msg, err  = null) => console.error(`[AutoImport CS] ${msg}`, err  || ''),
    warn:  (msg, data = null) => console.warn(`[AutoImport CS] ${msg}`, data || '')
};

let isProcessing = false;

// ===== تزریق override برای confirm/alert در MAIN world از طریق background =====
// (روش مطمئن: background.js با chrome.scripting.executeScript + world:MAIN کار می‌کند)
(function injectConfirmOverride() {
    try {
        chrome.runtime.sendMessage({ action: 'injectMainWorldConfirm' }, (res) => {
            if (chrome.runtime.lastError) return; // tab ممکن است هنوز آماده نباشد
            aiLogger.info('Confirm/alert override injected via MAIN world:', res?.success);
        });
    } catch(e) {}
})();

// ===================================================
// ۱. تشخیص نوع صفحه و تزریق مناسب
// ===================================================
function detectPageAndInject() {
    // صفحه لیست ایمیل (صندوق ورودی)
    if (document.getElementById('ResultsTable') ||
        document.querySelector('table.EmailGeneralFarsiTable2')) {
        injectEmailListButton();
        return;
    }

    // صفحه فرم وارده (ثبت نامه)
    if (document.getElementById('ulSave') || document.getElementById('ulSend') ||
        document.getElementById('txtImportOriginNO')) {
        injectImportFormButton();
        checkAndAutoFillFromStorage();
        return;
    }
}

// ===================================================
// ۲. صفحه لیست ایمیل
// ===================================================
function injectEmailListButton() {
    if (document.getElementById('ai-emaillist-btn')) return;

    // جستجوی گسترده‌تر برای toolbar - فارزین ممکن است ساختارهای مختلفی داشته باشد
    const toolbar = 
        document.querySelector('.ToolBarMainTable, .toolbar, #divToolBar') ||
        document.querySelector('table[id*="Tool"], td.ToolBarCell, .EmailToolBar') ||
        document.querySelector('#tdImportEmail, #divEmailToolBar, [id*="ToolBar"]') ||
        document.querySelector('td[id*="tool"], td[id*="Tool"], tr[id*="Tool"]') ||
        findToolbarByButtons() ||
        findToolbarByAnyButton();

    if (!toolbar) {
        aiLogger.warn('Email list toolbar not found, trying body injection');
        injectFloatingEmailButton();
        return;
    }

    const btnContainer = document.createElement('span');
    btnContainer.id = 'ai-emaillist-btn';
    btnContainer.innerHTML = buildButtonHTML('ثبت هوشمند وارده');
    toolbar.appendChild ? toolbar.appendChild(btnContainer) : toolbar.insertAdjacentElement('afterend', btnContainer);

    btnContainer.querySelector('.ai-smart-btn').addEventListener('click', handleEmailListImport);
    aiLogger.info('Email list button injected');
}

function injectFloatingEmailButton() {
    if (document.getElementById('ai-emaillist-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'ai-emaillist-btn';
    btn.style.cssText = `position:fixed;top:12px;left:12px;z-index:999999;`;
    btn.innerHTML = buildButtonHTML('ثبت هوشمند وارده');
    document.body.appendChild(btn);
    btn.querySelector('.ai-smart-btn').addEventListener('click', handleEmailListImport);
}

function findToolbarByButtons() {
    const knownBtns = document.querySelectorAll('[class*="ICON-Import"], [title*="وارده"], [onclick*="Import"]');
    for (const btn of knownBtns) {
        const row = btn.closest('tr') || btn.closest('div');
        if (row) return row;
    }
    return null;
}

// fallback: هر tr یا td که دکمه‌های عملیاتی در آن باشند
function findToolbarByAnyButton() {
    // دنبال td/tr که در آن چند دکمه‌ عملیاتی (ICON) باشند
    for (const el of document.querySelectorAll('tr, td, div')) {
        const icons = el.querySelectorAll('[class*="ICON-"]');
        if (icons.length >= 2) return el;
    }
    return null;
}

function buildButtonHTML(label) {
    return `
    <button type="button" class="ai-smart-btn" style="
        cursor:pointer; display:inline-flex; align-items:center; gap:5px;
        padding:5px 12px; margin:0 4px;
        background:linear-gradient(135deg,#6366f1,#8b5cf6);
        border:none; border-radius:6px; color:#fff; font-size:12px;
        font-family:Tahoma,sans-serif; box-shadow:0 2px 8px rgba(99,102,241,.4);
        white-space:nowrap; vertical-align:middle;">
        <span style="font-size:15px">🤖</span>
        <span>${label}</span>
    </button>`;
}

// --- پردازش ردیف انتخاب شده از لیست ایمیل ---
async function handleEmailListImport() {
    if (isProcessing) { showNotification('⏳ در حال پردازش...', 'warning'); return; }

    // پیدا کردن ردیف انتخاب‌شده
    const selectedRow = document.querySelector('tr.Table-Row-Select, tr.Table-Row-HighLight.Table-Row-Select');
    if (!selectedRow) {
        showNotification('⚠️ ابتدا یک ایمیل از لیست انتخاب کنید', 'warning');
        return;
    }

    isProcessing = true;
    showNotification('🔍 در حال خواندن اطلاعات ایمیل...', 'info');

    try {
        // استخراج receivexml
        const xmlStr = selectedRow.getAttribute('receivexml');
        if (!xmlStr) throw new Error('اطلاعات ایمیل در ردیف انتخابی پیدا نشد');

        const emailData = parseReceiveXML(xmlStr);
        aiLogger.info('Email data parsed:', emailData);

        // تطبیق فرستنده با دفترچه آدرس
        let matchedSender = null;
        if (emailData.senderEmail || emailData.senderName) {
            const res = await chrome.runtime.sendMessage({
                action: 'matchSender',
                payload: { name: emailData.senderName, email: emailData.senderEmail }
            });
            if (res.success && res.data) matchedSender = res.data;
        }

        // ساخت داده نهایی برای فرم
        const formData = {
            source: 'emailList',
            originNo: emailData.documentNumber || emailData.subject || '',
            originDate: emailData.persianDate || null,
            sender: matchedSender ? matchedSender.name : (emailData.senderName || ''),
            senderEmail: matchedSender ? matchedSender.email : (emailData.senderEmail || ''),
            subject: emailData.subject || '',
            description: emailData.bodyText ? emailData.bodyText.substring(0, 200) : '',
            keywords: '',
            _raw: emailData
        };

        // ذخیره در storage برای استفاده در فرم وارده
        await chrome.storage.local.set({ autoimport_pending: formData });
        aiLogger.info('Form data saved to storage:', formData);

        showNotification('✅ اطلاعات استخراج شد. حالا فرم وارده را باز کنید', 'success');

        // تلاش برای کلیک روی دکمه "ثبت وارده"
        tryClickImportDocButton(selectedRow);

    } catch (err) {
        aiLogger.error('handleEmailListImport error:', err);
        showNotification('❌ خطا: ' + err.message, 'error');
    } finally {
        isProcessing = false;
    }
}

// --- پارس receivexml ---
function parseReceiveXML(xmlStr) {
    // decode HTML entities
    const decoded = xmlStr
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&zwnj;/g, '\u200c');

    const getAttr = (name) => {
        const m = decoded.match(new RegExp(`${name}="([^"]*)"`));
        return m ? m[1].trim() : '';
    };

    const senderName  = getAttr('Receives_SenderName');
    const senderEmail = getAttr('Receives_SenderEmailAddress');
    const subject     = getAttr('Receives_Subject');
    const bodyText    = getAttr('Receives_BodyText');
    const persianDateRaw = getAttr('Receives_Pop3PersianReceiveDate');

    // شماره مدرک (اگر در farzinreceives_indicatordocnumber بود)
    const docNumRaw = getAttr('FarzinReceives_IndicatorDocNumber');

    // پارس تاریخ فارسی: "07 / 04 / 1405"
    let persianDate = null;
    const dateMatch = persianDateRaw.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
        .match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
    if (dateMatch) {
        persianDate = {
            day:   dateMatch[1].padStart(2, '0'),
            month: dateMatch[2].padStart(2, '0'),
            year:  dateMatch[3].substring(2) // 2 رقم آخر سال: 1405 → 05
        };
    }

    return { senderName, senderEmail, subject, bodyText, persianDate, documentNumber: docNumRaw };
}

// --- تلاش برای کلیک دکمه ثبت وارده ---
function tryClickImportDocButton(row) {
    // دکمه ثبت وارده معمولاً در همان ردیف یا در نوار ابزار است
    const importIcons = row.querySelectorAll('[class*="ICON-Import"], [title*="ثبت وارده"], [onclick*="ImportDocument"]');
    if (importIcons.length > 0) {
        importIcons[0].click();
        return;
    }
    // بررسی ستون "ثبت وارده" (td شامل td#ImportedReceiveTh)
    const cells = row.querySelectorAll('td');
    for (const cell of cells) {
        const inner = cell.querySelector('[class*="ICON"], [onclick]');
        if (inner && (inner.title || '').includes('وارده')) {
            inner.click();
            return;
        }
    }
    aiLogger.warn('Import button in row not found - user should manually open import form');
}

// ===================================================
// ۳. صفحه فرم وارده (ثبت نامه)
// ===================================================
function injectImportFormButton() {
    if (document.getElementById('ai-importform-btn')) return;

    const saveBtn = document.getElementById('ulSave') || document.getElementById('ulSend');
    if (!saveBtn) return;

    const toolbar = saveBtn.closest('tr') || saveBtn.closest('td') || saveBtn.parentElement;
    if (!toolbar) return;

    const btnCell = document.createElement('td');
    btnCell.innerHTML = buildButtonHTML('ثبت هوشمند');
    btnCell.id = 'ai-importform-btn';
    toolbar.insertBefore(btnCell, toolbar.firstChild);

    btnCell.querySelector('.ai-smart-btn').addEventListener('click', startFormAutoImport);

    // کلید میانبر
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
            e.preventDefault();
            startFormAutoImport();
        }
    });

    aiLogger.info('Import form button injected');
}

// --- بررسی اگر داده pending در storage هست ---
async function checkAndAutoFillFromStorage() {
    const stored = await chrome.storage.local.get(['autoimport_pending']);
    if (stored.autoimport_pending) {
        await sleep(1500); // صبر برای لود کامل فرم
        const data = stored.autoimport_pending;
        aiLogger.info('Auto-filling from stored email list data:', data);
        showPanel();
        updatePanelStep(1, 'done', 'اطلاعات از ایمیل استخراج شد ✓');
        updatePanelStep(2, 'loading', 'در حال OCR و آنالیز تصویر نامه...');

        // ترکیب داده‌های ایمیل با OCR تصویر
        await enrichWithOCR(data);
    }
}

// --- غنی‌سازی داده‌ها: دریافت تمام فایل‌های ضمیمه و OCR ---
async function enrichWithOCR(baseData) {
    // استفاده از تابع مشترک برای باز کردن منوی زنجیره مدرک، دانلود فایل‌ها و ارسال به هوش مصنوعی
    const result = await extractAndAnalyzeFiles(baseData);
    const letterData = result.letterData;
    const analysisSuccess = result.analysisSuccess;

    if (!analysisSuccess) {
        updatePanelStep(2, 'error', 'خطا در استخراج فایل‌ها یا هوش مصنوعی (استفاده از اطلاعات پایه)');
    }

    await chrome.storage.local.remove(['autoimport_pending']);
    updatePanelStep(3, 'loading', 'در حال پر کردن فیلدها...');
    await fillFormFields(letterData);
    updatePanelStep(3, 'done', 'فیلدها پر شدند ✓');
    await executeAutoSaveAndSend();
}

// --- ترکیب داده‌های ایمیل و OCR ---
function mergeData(base, ocr) {
    return {
        originNo:    ocr.originNo    || base.originNo    || '',
        originDate:  ocr.originDate  || base.originDate  || null,
        sender:      base.sender     || ocr.sender       || '',  // ایمیل اولویت دارد
        senderEmail: base.senderEmail|| ocr.senderEmail  || '',
        subject:     ocr.subject     || base.subject     || '',
        description: ocr.description || base.description || '',
        keywords:    ocr.keywords    || '',
        rawText:     ocr.rawText     || ''
    };
}

// --- شروع از داخل فرم (جریان جدید: گیرنده → ذخیره → OCR → پر کردن → ذخیره → ارجاع) ---
async function startFormAutoImport() {
    if (isProcessing) { showNotification('⏳ در حال پردازش...', 'warning'); return; }
    isProcessing = true;
    showPanel();

    try {
        // مرحله ۱: خواندن اطلاعات موجود فرم
        updatePanelStep(1, 'loading', 'در حال خواندن اطلاعات فرم...');
        let existingData = readExistingFormData();
        
        // ادغام با داده‌های ایمیل (اگر وجود داشته باشد) تا اطلاعات از دست نرود
        try {
            const pending = await chrome.storage.local.get('autoimport_pending');
            if (pending && pending.autoimport_pending && pending.autoimport_pending.data) {
                const em = pending.autoimport_pending.data;
                existingData.sender = em.sender || existingData.sender;
                existingData.senderEmail = em.senderEmail || existingData.senderEmail;
                existingData.subject = em.subject || existingData.subject;
                existingData.originNo = em.originNo || existingData.originNo;
                existingData.description = em.description || existingData.description;
            }
        } catch(e) {}
        
async function extractAndAnalyzeFiles(letterData) {
    let analysisSuccess = false;

    updatePanelStep(3, 'loading', 'در حال باز کردن منوی فایل‌های ضمیمه...');
    
    // ۱. پیدا کردن دکمه و کلیک روی آن
    for (const doc of allDocs()) {
        const depBtn = doc.getElementById('ulDependency');
        if (depBtn) {
            try { depBtn.click(); } catch(e) {}
            break; // یک بار کلیک کافیست
        }
    }
    
    // ۲. تلاش برای پیدا کردن منوی باز شده در تمام صفحات (تا ۳۰ ثانیه)
    let scannedDiv = null;
    let foundDoc = null;
    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        updatePanelStep(3, 'loading', `در حال جستجوی منوی پیوست‌ها... (تلاش ${i+1} از 30)`);
        for (const doc of allDocs()) {
            const div = doc.getElementById('ScannedImages');
            if (div && div.innerHTML.includes('DownLoad_OnClick')) {
                scannedDiv = div;
                foundDoc = doc;
                break;
            }
        }
        if (scannedDiv) {
            aiLogger.info('✅ ScannedImages found on attempt ' + (i+1));
            break;
        }
    }
    
    // ۳. استخراج فایل‌ها
    let allFiles = [];
    if (scannedDiv) {
        const downloadBtns = scannedDiv.querySelectorAll('div[onclick*="DownLoad_OnClick"]');
        for (const btn of downloadBtns) {
            const onclick = btn.getAttribute('onclick') || '';
            if (onclick.includes("'true'")) {
                let labelStr = 'فایل ' + (allFiles.length + 1);
                let ext = '';
                const tr = btn.closest('tr');
                if (tr) {
                    const lbl = tr.querySelector('label');
                    if (lbl && lbl.innerText) {
                        labelStr = lbl.innerText.trim();
                        if (labelStr.includes('.')) ext = labelStr.substring(labelStr.lastIndexOf('.')).toLowerCase();
                    }
                }
                if (!SKIP_EXTENSIONS.has(ext)) {
                    allFiles.push({ type: 'btn', btn, label: labelStr });
                }
            }
        }
    }
    
    // اگر از منوی بالا چیزی پیدا نشد، از روش قبلی استفاده کن
    if (allFiles.length === 0) {
        allFiles = getAllFileUrls().map(f => ({ type: 'url', url: f.url, label: f.label }));
    }
    
    aiLogger.info(`📂 Found ${allFiles.length} file(s):`, allFiles.map(f => f.label));

    // دیالوگ را اینجا نمی‌بندیم چون برای کلیک روی دکمه‌ها در حالت بومی، باید باز بماند.

    if (allFiles.length > 0) {
        updatePanelStep(3, 'loading', `آماده دانلود بومی ${allFiles.length} فایل ضمیمه...`);
        try {
            // دانلود فایل‌ها به صورت بومی و استخراج متن
            const downloadedFiles = await downloadAndConvertFiles(allFiles, foundDoc || document);
            // فقط فایل‌های با موفقیت دانلود شده را نگه دار
            const validFiles = downloadedFiles.filter(f => f.success && f.text);
            
            if (validFiles.length > 0) {
                updatePanelStep(3, 'loading', `در حال ارسال متن ${validFiles.length} فایل به هوش مصنوعی...`);
                
                let combinedText = '';
                for (let i = 0; i < validFiles.length; i++) {
                    combinedText += `\n\n--- [${validFiles[i].label}] ---\n${validFiles[i].text}`;
                }

                // ارسال به پس‌زمینه برای آنالیز ساختاریافته متنی
                const ocrRes = await chrome.runtime.sendMessage({
                    action: 'ocrAndAnalyzeLetter',
                    payload: { extractedText: combinedText, baseData: letterData }
                });
                
                if (ocrRes.success) {
                    letterData = mergeData(letterData, ocrRes.data);
                    analysisSuccess = true;
                    showExtractedData(letterData, validFiles.map(f => f.label).join(', '));
                    updatePanelStep(3, 'done', `آنالیز متنی ${validFiles.length} فایل کامل شد ✓`);
                } else {
                    if (combinedText) {
                        letterData.description = (letterData.description || '') + '\n\nمتن استخراج شده:\n' + combinedText;
                    }
                    updatePanelStep(3, 'error', `خطای هوش مصنوعی: ${ocrRes.error || 'نامشخص'}`);
                }
            } else {
                updatePanelStep(3, 'error', `هیچ فایلی با موفقیت دانلود و تبدیل نشد.`);
            }
        } catch (e) {
            updatePanelStep(3, 'error', `خطای سیستمی: ${e.message}`);
        }
    } else {
        updatePanelStep(3, 'done', 'فایل قابل OCR یافت نشد — از اطلاعات فعلی استفاده می‌شود ✓');
    }
    // ۵. بستن پنجره پاپ‌آپ زنجیره مدرک (بعد از اتمام دانلودها)
    if (scannedDiv) {
        aiLogger.info('Closing dependency dialog...');
        try {
            const btnClose = foundDoc.getElementById('btnClose');
            if (btnClose) btnClose.click();
            else {
                const altClose = window.top.document.querySelector('.ui-dialog-titlebar-close');
                if (altClose) altClose.click();
            }
        } catch(e) {}
    }

    return { letterData, analysisSuccess };
}

// چک می‌کنیم آیا نامه از نوع "رسید خواندن" است؟
        if (existingData.subject && (existingData.subject.includes('رسید خواندن') || existingData.subject.includes('رسيد خواندن'))) {
            aiLogger.info('Read receipt detected from email data, aborting registration.');
            updatePanelStep(1, 'done', 'رسید خواندن تشخیص داده شد، توقف عملیات ✓');
            showNotification('ℹ️ نامه رسید خواندن است. نیازی به ثبت و ارجاع نیست.', 'info');
            await handleAutoCloseTab();
            return;
        }

        updatePanelStep(1, 'done', 'اطلاعات فرم خوانده شد ✓');

        // مرحله ۲: فقط گیرنده (کد ۱۰ + مدیریت اداره کل) را پر کن و ذخیره کن
        updatePanelStep(2, 'loading', 'در حال ثبت اولیه‌ (OCR هنوز انجام نشده)...');
        await setReceiverField();
        await clickSave();
        updatePanelStep(2, 'done', 'ثبت اولیه موفق ✓');

        // مرحله ۳: دریافت فایل‌های ضمیمه و آنالیز با هوش مصنوعی
        const result = await extractAndAnalyzeFiles(existingData);
        let letterData = result.letterData;
        let analysisSuccess = result.analysisSuccess;

        if (!analysisSuccess) {
            updatePanelStep(3, 'error', 'خطا در آنالیز ضمیمه‌ها (ادامه با دیتای خام)');
        }

        // مرحله ۴: پر کردن تمام فیلدها و ذخیره نهایی
        updatePanelStep(4, 'loading', 'در حال پر کردن فیلدها و ذخیره نهایی...');
        await fillFormFields(letterData);
        await clickSave();
        updatePanelStep(4, 'done', 'فیلدها پر شدند و ذخیره شد ✓');

        // مرحله ۵: ارجاع
        updatePanelStep(5, 'loading', 'در حال ارجاع...');
        let refName = 'كلاري محسن';
        try {
            const stored = await chrome.storage.local.get(['autoimport_config']);
            if (stored.autoimport_config?.referralPersonName) {
                refName = stored.autoimport_config.referralPersonName;
            }
        } catch(e) {}

        await clickSendAndHandle(refName);
        updatePanelStep(5, 'done', 'نامه ارجاع داده شد ✓');
        showNotification('✅ نامه با موفقیت ثبت و ارجاع داده شد', 'success');

        await handleAutoCloseTab();

    } catch (err) {
        aiLogger.error('startFormAutoImport error:', err);
        showNotification('❌ خطا: ' + err.message, 'error');
        updateCurrentStepError(err.message);
    } finally {
        isProcessing = false;
    }
}

// --- خواندن داده‌های موجود از فرم (ایمیل فرستنده و...) ---
function readExistingFormData() {
    const senderEmailEl = document.getElementById('txtSenderCellorEmail');
    const senderEmail = senderEmailEl ? senderEmailEl.value.trim() : '';

    const senderInput = document.getElementById('Sender_tbxAutocomplete');
    const senderName = senderInput ? senderInput.value.trim() : '';

    const originNoEl = document.getElementById('txtImportOriginNO');
    const originNo = originNoEl ? originNoEl.value.trim() : '';

    const dayEl = document.getElementById('ViewImportOriginDate_Day');
    const monthEl = document.getElementById('ViewImportOriginDate_Month');
    const yearEl = document.getElementById('ViewImportOriginDate_Year');
    let originDate = null;
    if (dayEl && monthEl && yearEl && dayEl.value && monthEl.value && yearEl.value) {
        originDate = {
            day: dayEl.value.trim(),
            month: monthEl.value.trim(),
            year: yearEl.value.trim()
        };
    }

    const subjectEl = document.getElementById('txtSubject_tbxAutocomplete');
    const subject = subjectEl ? subjectEl.value.trim() : '';

    const isFullyFilled = !!(originNo && originDate && subject && senderName);

    return { 
        senderEmail, 
        sender: senderName, 
        originNo, 
        originDate, 
        subject, 
        description: '', 
        keywords: '',
        isFullyFilled
    };
}

async function handleAutoCloseTab() {
    try {
        const settings = await chrome.storage.local.get(['autoimport_autoclose']);
        if (settings.autoimport_autoclose) {
            aiLogger.info('Auto-close is enabled, attempting to close registration tab...');
            let closeBtn = null;
            
            // تب‌ها معمولا در پنجره پدر (Parent) یا بالاترین پنجره (Top) هستند
            const docsToSearch = [window.parent.document, window.top.document, document];

            // استراتژی ۱: پیدا کردن تمام دکمه‌های بستن در تب‌ها بر اساس متن "وارده"
            for (const doc of docsToSearch) {
                if (!doc) continue;
                const allCloseButtons = Array.from(doc.querySelectorAll('button.close, .close, [id^="btn-"]'));
                
                for (const btn of allCloseButtons) {
                    const tabContainer = btn.closest('li') || btn.closest('a') || btn.parentElement;
                    if (!tabContainer) continue;
                    
                    const tabText = (tabContainer.textContent || '').replace(/\s+/g, ' ').trim();
                    
                    // جستجوی کلمات کلیدی
                    if (tabText.includes('وارده') || tabText.includes('ثبت')) {
                        // یک چک امنیتی: مطمئن شویم تب دریافت یا صندوق نیست
                        if (!tabText.includes('دريافت') && !tabText.includes('دریافت') && !tabText.includes('صندوق')) {
                            closeBtn = btn;
                            break;
                        }
                    }
                }
                if (closeBtn) break;
            }

            // استراتژی ۲: استفاده از ID فریم فعلی (ممکن است ID روی div پدر iframe باشد)
            if (!closeBtn && window.frameElement) {
                const frameId = window.frameElement.id || (window.frameElement.parentElement ? window.frameElement.parentElement.id : '');
                const tabIdMatch = frameId.match(/\d+/);
                
                if (tabIdMatch) {
                    for (const doc of docsToSearch) {
                        if (!doc) continue;
                        const potentialBtn = doc.getElementById('btn-' + tabIdMatch[0]) || doc.querySelector(`[tabid="${tabIdMatch[0]}"] button.close`);
                        if (potentialBtn) {
                            const tabContainer = potentialBtn.closest('li') || potentialBtn.closest('a') || potentialBtn.parentElement;
                            const tabText = tabContainer ? (tabContainer.textContent || '') : '';
                            
                            // چک امنیتی سخت‌گیرانه: اگر تب مربوط به دریافت/صندوق نباشد، می‌بندیمش
                            if (!tabText.includes('دريافت') && !tabText.includes('دریافت') && !tabText.includes('صندوق')) {
                                closeBtn = potentialBtn;
                                break;
                            }
                        }
                    }
                }
            }

            if (closeBtn) {
                aiLogger.info('Registration tab close button found! Simulating click in 1.5s...', closeBtn);
                setTimeout(() => {
                    try {
                        aiLogger.info('Executing click on tab close button...');
                        // 1. روش عادی
                        closeBtn.click();
                        // 2. روش MouseEvent
                        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window.top });
                        closeBtn.dispatchEvent(clickEvent);
                    } catch(err) {
                        aiLogger.warn('Error clicking close button:', err);
                    }
                }, 1500); 
            } else {
                aiLogger.warn('Could not find registration tab close button. Aborting auto-close to prevent closing wrong tabs.');
            }
        } else {
            aiLogger.info('Auto-close setting is OFF.');
        }
    } catch(e) {
        aiLogger.warn('Auto-close error:', e);
    }
}

// ===================================================
// ۴. پر کردن فیلدهای فرم
// ===================================================
async function fillFormFields(data) {
    // شماره اولیه مدرک
    if (data.originNo) {
        const el = document.getElementById('txtImportOriginNO');
        if (el) setVal(el, data.originNo);
    }

    // تاریخ اولیه مدرک
    if (data.originDate) {
        const { day, month, year } = data.originDate;
        const dayEl   = document.getElementById('ViewImportOriginDate_Day');
        const monthEl = document.getElementById('ViewImportOriginDate_Month');
        const yearEl  = document.getElementById('ViewImportOriginDate_Year');
        const constEl = document.getElementById('txtOrigionConstYear');
        if (dayEl && day)     setVal(dayEl,   toEnglishDigits(String(day).padStart(2,'0')));
        if (monthEl && month) setVal(monthEl, toEnglishDigits(String(month).padStart(2,'0')));
        if (yearEl && year) {
            const y2 = String(year).length === 4 ? String(year).substring(2) : String(year);
            const y2c = String(year).length === 4 ? String(year).substring(0, 2) : '14';
            setVal(yearEl,  toEnglishDigits(y2));
            if (constEl) setVal(constEl, toEnglishDigits(y2c));
        }
    }

    // فرستنده
    const senderName = data.sender || '';
    if (senderName) {
        const el = document.getElementById('Sender_tbxAutocomplete');
        if (el) setVal(el, senderName);
    }

    // ایمیل/تلفن فرستنده
    if (data.senderEmail) {
        const el = document.getElementById('txtSenderCellorEmail');
        if (el) setVal(el, data.senderEmail);
    }

    // گیرنده — همیشه مدیریت اداره کل (کد ۱۰)
    await setReceiverField();

    // موضوع
    if (data.subject) {
        const el = document.getElementById('txtSubject_tbxAutocomplete');
        if (el) setVal(el, data.subject);
    }

    // توضیحات (متن کامل تصحیح شده نامه توسط هوش مصنوعی)
    const bodyContent = data.description || data.rawText || '';
    const descText = (data.originNo ? 'شماره: ' + data.originNo + '\n\n' : '') + bodyContent;
    if (descText.trim()) {
        const el = document.getElementById('txtImportDesc');
        if (el) setVal(el, descText);
    }

    // کلیدواژه (گذر واژه) - قرار شد نام فرستنده یا سازمان به علاوه کلیدواژه‌ها وارد شود
    const kwText = [data.sender, data.keywords].filter(x => x).join(' - ');
    if (kwText) {
        const el = document.getElementById('txtAreaDocKeywords');
        if (el) setVal(el, kwText);
    }

    await sleep(300);
}

async function setReceiverField() {
    const receiverInput = document.getElementById('Receiver_tbxAutocomplete');
    if (receiverInput) setVal(receiverInput, 'مدیریت اداره کل');

    const receiverCode = document.getElementById('txtReceiverCode');
    if (receiverCode) setVal(receiverCode, '10');

    const subjectCode = document.getElementById('txtSubjectCode');
    if (subjectCode) setVal(subjectCode, '10');
}

// ===================================================
// ۵. ذخیره و ارجاع
// ===================================================
async function executeAutoSaveAndSend() {
    updatePanelStep(4, 'loading', 'در حال ذخیره نامه...');
    await clickSave();
    updatePanelStep(4, 'done', 'نامه ذخیره شد ✓');

    updatePanelStep(5, 'loading', 'در حال ارجاع...');
    
    // دریافت نام شخص ارجاع از تنظیمات
    let refName = 'كلاري محسن';
    try {
        const stored = await chrome.storage.local.get(['autoimport_config']);
        if (stored.autoimport_config?.referralPersonName) {
            refName = stored.autoimport_config.referralPersonName;
        }
    } catch(e) {}

    await clickSendAndHandle(refName);
    updatePanelStep(5, 'done', 'نامه ارجاع داده شد ✓');

    showNotification('✅ نامه با موفقیت ثبت و ارجاع داده شد', 'success');

    await handleAutoCloseTab();

}

async function clickSave() {
    const btn = document.getElementById('ulSave');
    if (!btn) throw new Error('دکمه ذخیره (ulSave) پیدا نشد');
    btn.click();
    await sleep(3500);
}

async function clickSendAndHandle(refName) {
    const btn = document.getElementById('ulSend');
    if (!btn) throw new Error('دکمه ارجاع (ulSend) پیدا نشد');
    btn.click();
    // صبر بیشتر برای لود کامل پاپ‌آپ ارجاع
    await sleep(3500);

    // پیدا کردن شخص ارجاع در پاپ‌آپ (افزایش زمان انتظار به 30 ثانیه)
    const found = await waitForReferralPerson(30000, refName);
    if (!found) {
        // لاگ تشخیصی: نمایش تمام متن‌های موجود در صفحه برای دیباگ
        const allText = [...document.querySelectorAll('label, td, span, button')].map(e => e.textContent.trim()).filter(t => t.length > 2 && t.length < 50).slice(0, 30);
        aiLogger.warn('Referral popup debug - visible texts:', allText.join(' | '));
        throw new Error(`شخص ارجاع (${refName}) در پاپ‌آپ پیدا نشد`);
    }

    await sleep(800);
    await clickReferralOK();
    await sleep(500);
    closeReferralPopup();
}

// ===================================================
// ۶. پاپ‌آپ ارجاع
// ===================================================
async function waitForReferralPerson(timeout, refName) {
    const end = Date.now() + timeout;
    let iteration = 0;
    while (Date.now() < end) {
        // جستجو در تمام داکیومنت‌ها (شامل iframeهای تو در تو)
        for (const doc of allDocs()) {
            if (clickReferralPersonIn(doc, refName)) return true;
        }
        // جستجو در popup window (اگر پاپ‌آپ در پنجره جدید باز شده)
        try {
            for (let i = 0; i < window.frames.length; i++) {
                try {
                    const frameDoc = window.frames[i].document;
                    if (frameDoc && clickReferralPersonIn(frameDoc, refName)) return true;
                } catch(fe) {}
            }
        } catch(e) {}

        if (iteration === 10) { // بعد از 5 ثانیه، اسکن در بک‌گراند را هم استارت بزن
            chrome.runtime.sendMessage({ action: 'watchReferralPopup', payload: { refName } }, res => {
                if (res && res.success) {
                    aiLogger.info('Referral found by background scanner!');
                }
            });
        }
        
        if (iteration % 4 === 0) aiLogger.info(`Waiting for referral popup... (${Math.round((Date.now()-(end-timeout))/1000)}s)`);
        iteration++;
        await sleep(500);
    }
    return false;
}

function clickReferralPersonIn(doc, refName) {
    if (!refName || refName.trim().length < 2) return false;

    // نرمالیزاسی کاراکتر: حذف فاصله/ZWNJ + یکسان کردن ی/ی (عربی/فارسی) و ک/ک
    const normalize = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/[\s\u200C\u200D]+/g, '')  // حذف فاصله‌ها
            .replace(/\u064A/g, '\u06CC')      // عربی ی (U+064A) → فارسی ی (U+06CC)
            .replace(/\u0643/g, '\u06A9')      // عربی ک (U+0643) → فارسی ک (U+06A9)
            .replace(/\u06CC/g, '\u06CC')      // normalize Persian ya
            .replace(/\u06A9/g, '\u06A9');     // normalize Persian ka
    };
    const target = normalize(refName);
    aiLogger.info('Referral target (normalized):', target, 'from:', refName);

    // Helper: کلیک واقعی (بدون بررسی offsetParent که در iframe کار نمی‌کند)
    const doClick = (el) => {
        if (!el) return false;
        try {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
            el.click();
            return true;
        } catch(e) { return false; }
    };

    // روش ۱: جستجوی اختصاصی در جدول #SelectionPersonnelBlock_friends
    const friendsTable = doc.getElementById('SelectionPersonnelBlock_friends');
    if (friendsTable) {
        aiLogger.info('Found SelectionPersonnelBlock_friends table');
        // جستجو در سطر‌های دارای firstname/lastname
        for (const tr of friendsTable.querySelectorAll('tr[firstname], tr[lastname]')) {
            const fn = normalize(tr.getAttribute('firstname') || '');
            const ln = normalize(tr.getAttribute('lastname') || '');
            const full = ln + fn; // لقب + نام (مثل: کلاریمحسن)
            const full2 = fn + ln;
            aiLogger.info('Checking TR:', fn, ln, '→', full, 'vs target:', target);
            if (full.includes(target) || full2.includes(target) || target.includes(ln) || target.includes(fn)) {
                // لیبل با onclick روی AddPersonnelToTable
                const lbl = tr.querySelector('label[onclick*="AddPersonnelToTable"]');
                if (lbl) {
                    doClick(lbl);
                    aiLogger.info('✅ Referral clicked via SelectionPersonnelBlock (label onclick)');
                    return true;
                }
                // اگر label پیدا نشد، روی تد سوم کلیک کن
                const td3 = tr.querySelectorAll('td')[2];
                if (td3) {
                    doClick(td3);
                    aiLogger.info('✅ Referral clicked via td[2]');
                    return true;
                }
            }
        }
    }

    // روش ۲: جستجو عمومی در تمام سطر‌های TR دارای اتریبیوت
    for (const tr of doc.querySelectorAll('tr[firstname], tr[lastname]')) {
        const fn = normalize(tr.getAttribute('firstname') || '');
        const ln = normalize(tr.getAttribute('lastname') || '');
        const full = ln + fn;
        const full2 = fn + ln;
        if (full.includes(target) || full2.includes(target) || target.includes(ln) || target.includes(fn)) {
            const lbl = tr.querySelector('label[onclick*="AddPersonnelToTable"]') ||
                        tr.querySelector('label[onclick]');
            if (lbl) {
                doClick(lbl);
                aiLogger.info('✅ Referral clicked via TR[firstname] global search');
                return true;
            }
        }
    }

    // روش ۳: جستجو label با onclick=AddPersonnelToTable که نام شخص در title یا textContent دارد
    for (const lbl of doc.querySelectorAll('label[onclick*="AddPersonnelToTable"]')) {
        const txt = normalize(lbl.textContent + ' ' + (lbl.getAttribute('title') || ''));
        if (txt.includes(target) || (target.length > 3 && txt.includes(normalize(refName.split(' ')[0])))) {
            doClick(lbl);
            aiLogger.info('✅ Referral clicked via label[AddPersonnelToTable] textContent');
            return true;
        }
    }

    return false;
}


async function clickReferralOK() {
    const okTexts = ['ok','تأیید','تایید','ثبت','ارسال','ارجاع','confirm'];
    
    // اولویت اول: جستجو با آیدی OK یا کلاس BtnDocumentSend
    for (const doc of allDocs()) {
        const btnOk = doc.getElementById('OK') || doc.querySelector('.BtnDocumentSend');
        if (btnOk) {
            btnOk.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            btnOk.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            btnOk.click();
            aiLogger.info('OK clicked via id/class');
            return true;
        }
    }

    // اولویت دوم: جستجوی متنی دکمه‌ها
    for (const doc of allDocs()) {
        for (const btn of doc.querySelectorAll('button, input[type="button"], input[type="submit"]')) {
            const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
            if (okTexts.some(t => txt.includes(t))) {
                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                btn.click(); 
                aiLogger.info('OK clicked via text:', txt); 
                return true;
            }
        }
    }
    return false;
}

function closeReferralPopup() {
    for (const doc of allDocs()) {
        for (const btn of doc.querySelectorAll('.ui-dialog-titlebar-close, .modal .close, [data-dismiss="modal"]')) {
            if (btn.offsetParent !== null) {
                btn.click(); 
                aiLogger.info('Referral popup closed safely'); 
                return;
            }
        }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

// ===================================================
// ۷. استخراج متن از صفحه (برای PDF خوانا)
// ===================================================
function extractTextFromPage() {
    // فقط iframeها را بررسی کن (سند اصلی تنها در آنها هست)
    // سند اصلی دارای متن خالص است بدون دکمه‌های ناویبار
    for (const iframe of document.querySelectorAll('iframe')) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc || !doc.body) continue;

            // PDF embed = قابل استخراج نیست
            const embed = doc.querySelector('embed[type="application/pdf"], object[type="application/pdf"]');
            if (embed) continue;

            const bodyText = (doc.body.innerText || '').trim();
            // فقط اگر متن به نظر محتوای نامه باشد (نه فقط منوی navها)
            if (bodyText.length > 200) {
                aiLogger.info('Text extracted from iframe, length:', bodyText.length);
                return bodyText;
            }
        } catch (e) {
            // Cross-origin
        }
    }
    return null;
}


// ===================================================
// ۸. پیدا کردن همه فایل‌های ضمیمه نامه
// ===================================================
const SKIP_EXTENSIONS = new Set([
    '.zip', '.rar', '.7z', '.tar', '.gz',       // فشرده
    '.xls', '.xlsx', '.xlsm', '.ods',           // اکسل
    '.doc', '.docx', '.odt',                    // ورد
    '.ppt', '.pptx',                            // پاورپوینت
    '.exe', '.msi', '.apk',                     // اجرایی
    '.mp4', '.mp3', '.avi', '.mkv',             // رسانه
]);

// ===================================================
// ۸. استخراج تمام فایل‌ها و دانلود آن‌ها
// ===================================================
async function downloadAndConvertFiles(filesInfo, doc) {
    const results = [];
    for (let i = 0; i < filesInfo.length; i++) {
        const fileInfo = filesInfo[i];
        try {
            updatePanelStep(3, 'loading', `در حال دانلود بومی و استخراج متن ${fileInfo.label}...`);
            const startTime = Date.now();
            
            if (fileInfo.type === 'btn') {
                // کلیک واقعی روی دکمه برای دانلود نیتیو توسط مرورگر
                fileInfo.btn.click();
            } else if (fileInfo.type === 'url') {
                const a = document.createElement('a');
                a.href = fileInfo.url;
                a.download = '';
                a.click();
            }
            
            // منتظر دانلود شدن و گرفتن نتیجه متنی مستقیما از سرور محلی
            const res = await chrome.runtime.sendMessage({
                action: 'ocrNativeDownload',
                payload: { startTime }
            });
            
            if (res.success && res.text) {
                results.push({ success: true, text: res.text, label: fileInfo.label });
            } else {
                results.push({ success: false, error: res.error || 'Empty text', label: fileInfo.label });
            }
        } catch(err) {
            aiLogger.warn(`Failed native download/OCR for ${fileInfo.label}:`, err);
            results.push({ success: false, error: err.message, label: fileInfo.label });
        }
    }
    return results;
}

function getAllFileUrls() {
    const seen = new Set();

    // تابع کمکی برای ساخت URL کامل
    function resolveUrl(href, baseDoc) {
        if (!href) return null;
        try {
            if (href.startsWith('http')) return href;
            // از origin صفحه‌ای که iframe در آن است
            const base = baseDoc.location?.href || window.location.href;
            return new URL(href, base).href;
        } catch(e) { return null; }
    }

    function scanDoc(doc, depth = 0) {
        if (depth > 5 || !doc) return;

        // ۱. FileTabContent_N — فایل‌های ضمیمه اصلی
        for (const iframe of doc.querySelectorAll('iframe[id^="FileTabContent_"]')) {
            // attribute "url" اولویت دارد چون ticket تازه دارد
            const rawUrl = iframe.getAttribute('url') || iframe.getAttribute('src') || iframe.src || '';
            const fext   = (iframe.getAttribute('fileextention') || '').toLowerCase();
            const idx    = iframe.getAttribute('index') || iframe.id.replace('FileTabContent_', '');
            const label  = `فایل ${toFarsiDigits(idx)}`;

            if (!rawUrl || seen.has(rawUrl)) continue;
            if (SKIP_EXTENSIONS.has(fext)) {
                aiLogger.info(`⏭ ${label} skipped (${fext})`);
                continue;
            }

            const fullUrl = resolveUrl(rawUrl, doc);
            if (!fullUrl) continue;
            seen.add(rawUrl);
            aiLogger.info(`📎 Found ${label}:`, fullUrl.substring(0, 80));
            results.push({ url: fullUrl, label, ext: fext, index: parseInt(idx) || 99 });
        }

        // ۲. iframe های OutputStream/WriteBuffer/GetFile عمومی
        for (const iframe of doc.querySelectorAll('iframe:not([id^="FileTabContent_"])')) {
            const rawUrl = iframe.getAttribute('url') || iframe.getAttribute('src') || iframe.src || '';
            if (!rawUrl || seen.has(rawUrl)) continue;

            const isFile = rawUrl.includes('WriteBuffer') || rawUrl.includes('OutputStream') ||
                           rawUrl.includes('GetFile') || rawUrl.includes('ShowFile') ||
                           rawUrl.includes('DF.aspx') || rawUrl.includes('fileId=');
            if (!isFile) continue;

            const fullUrl = resolveUrl(rawUrl, doc);
            if (!fullUrl) continue;
            seen.add(rawUrl);
            aiLogger.info(`📎 Found general file iframe:`, fullUrl.substring(0, 80));
            results.push({ url: fullUrl, label: 'فایل', ext: '', index: 88 });
        }

        // ۳. img-scanned
        const scannedImg = doc.getElementById('img-scanned');
        if (scannedImg && scannedImg.src && scannedImg.src.length > 100 && !seen.has(scannedImg.src)) {
            seen.add(scannedImg.src);
            results.push({ url: scannedImg.src, label: 'تصویر اسکن', ext: '.png', index: 0 });
        }

        // ۴. جستجوی عمیق‌تر در iframe های فرزند
        for (const iframe of doc.querySelectorAll('iframe')) {
            try {
                const childDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (childDoc && childDoc !== doc) scanDoc(childDoc, depth + 1);
            } catch(e) {} // cross-origin silently ignored
        }
    }

    // شروع از بالاترین سطح
    try {
        scanDoc(window.top.document);
    } catch(e) {
        scanDoc(document);
    }

    return results.sort((a, b) => a.index - b.index);
}


// ===================================================
// ۸. پیدا کردن URL تصویر نامه (backward compat)
// ===================================================
function getLetterImageUrl() {
    // اولویت ۱: img با id="img-scanned" (تصویر مستقیم)
    for (const doc of allDocs()) {
        const scannedImg = doc.getElementById('img-scanned');
        if (scannedImg) {
            const src = (scannedImg.src || '').trim();
            if (src.length > 200) {
                aiLogger.info('img-scanned found, length:', src.length);
                return src;
            }
        }
    }

    // اولویت ۲: iframe که محتوایش PDF/WriteBuffer است (رایج‌ترین در BPMS)
    for (const doc of allDocs()) {
        for (const iframe of doc.querySelectorAll('iframe')) {
            const fsrc = iframe.src || iframe.getAttribute('src') || '';
            if (fsrc && (
                fsrc.includes('WriteBuffer') ||
                fsrc.includes('OutputStream') ||
                fsrc.includes('invokeCode') ||
                fsrc.includes('GetFile') ||
                fsrc.includes('ShowFile') ||
                fsrc.includes('ViewFile') ||
                fsrc.includes('DownloadFile') ||
                fsrc.includes('fileId=') ||
                fsrc.includes('FileId=')
            )) {
                const fullUrl = new URL(fsrc, window.location.href).href;
                aiLogger.info('WriteBuffer/PDF iframe found:', fullUrl.substring(0, 80));
                return fullUrl;
            }
        }
    }

    // اولویت ۳: لینک‌های فایل در sidebar (فایل ۱، فایل ۲، ...)
    for (const doc of allDocs()) {
        const fileLinks = doc.querySelectorAll('a[href*="WriteBuffer"], a[href*="GetFile"], a[href*="OutputStream"], a[href*="ShowFile"], a[href*="fileId"]');
        for (const link of fileLinks) {
            const href = link.href || '';
            if (href) {
                aiLogger.info('File link found:', href.substring(0, 80));
                return href;
            }
        }
    }

    // اولویت ۴: تصویر بزرگ که واقعاً نامه باشد (حداقل 400px)
    for (const doc of allDocs()) {
        for (const img of doc.querySelectorAll('img')) {
            const src = img.src || '';
            if (img.naturalWidth > 400 && img.naturalHeight > 400 && src && !src.includes('icon') && !src.includes('logo')) {
                aiLogger.info('Large image found:', src.substring(0, 80), img.naturalWidth + 'x' + img.naturalHeight);
                return src;
            }
        }

        // body > img مستقیم
        const bodyImg = doc.querySelector('body > img');
        if (bodyImg && bodyImg.naturalWidth > 200 && bodyImg.src) return bodyImg.src;
    }

    return null;
}

// ===================================================
// ۸. Helpers
// ===================================================
function setVal(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
}

function toFarsiDigits(str) {
    const p = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    return String(str).replace(/[0-9]/g, d => p[+d]);
}

function toEnglishDigits(str) {
    const persian = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    const arabic = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    let result = String(str);
    for (let i = 0; i < 10; i++) {
        result = result.replace(new RegExp(persian[i], 'g'), i).replace(new RegExp(arabic[i], 'g'), i);
    }
    return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getTopMostSameOriginWindow(win) {
    let current = win;
    while (current !== current.parent) {
        try {
            const doc = current.parent.document;
            if (doc) {
                current = current.parent;
            } else {
                break;
            }
        } catch (e) {
            break;
        }
    }
    return current;
}

function* allDocs(rootDoc = null) {
    if (!rootDoc) {
        try { 
            rootDoc = getTopMostSameOriginWindow(window).document; 
        } catch(e) { 
            rootDoc = document; 
        }
    }
    if (!rootDoc) return;
    yield rootDoc;
    for (const f of rootDoc.querySelectorAll('iframe')) {
        try { 
            const d = f.contentDocument || f.contentWindow?.document; 
            if (d) yield* allDocs(d); 
        } catch (e) {}
    }
}

// ===================================================
// ۹. UI پنل پیشرفت
// ===================================================
function showPanel() {
    document.getElementById('ai-autoimport-panel')?.remove();
    const panel = document.createElement('div');
    panel.id = 'ai-autoimport-panel';
    panel.innerHTML = `
        <div class="ai-panel-header">
            <span>🤖 ثبت هوشمند نامه وارده</span>
            <button onclick="this.closest('#ai-autoimport-panel').remove()">✕</button>
        </div>
        <div class="ai-panel-body">
            <div class="ai-steps">
                ${[[1,'🔍','خواندن اطلاعات'],[2,'🧠','OCR + آنالیز AI'],[3,'📝','پر کردن فیلدها'],[4,'💾','ذخیره'],[5,'📤','ارجاع']].map(
                    ([n,ic,lb]) => `<div class="ai-step" id="ai-step-${n}">
                        <span class="ai-step-icon">${ic}</span>
                        <span class="ai-step-label">${lb}</span>
                        <span class="ai-step-status" id="ai-step-status-${n}">⏳</span>
                    </div>`).join('')}
            </div>
            <div id="ai-extracted-data" style="display:none;"></div>
            <div id="ai-panel-msg" class="ai-panel-message"></div>
        </div>`;
    document.body.appendChild(panel);
}

function updatePanelStep(n, state, msg) {
    const step   = document.getElementById(`ai-step-${n}`);
    const status = document.getElementById(`ai-step-status-${n}`);
    const msgEl  = document.getElementById('ai-panel-msg');
    if (step)   step.className  = `ai-step ai-step-${state}`;
    if (status) status.textContent = { loading:'⏳', done:'✅', error:'❌' }[state] || '⏳';
    if (msgEl)  { msgEl.textContent = msg; msgEl.className = `ai-panel-message ai-msg-${state}`; }
}

function updateCurrentStepError(msg) {
    const msgEl = document.getElementById('ai-panel-msg');
    if (msgEl) { msgEl.textContent = '❌ ' + msg; msgEl.className = 'ai-panel-message ai-msg-error'; }
}

function showExtractedData(data) {
    const c = document.getElementById('ai-extracted-data');
    if (!c) return;
    const rows = [
        ['📌 شماره نامه', data.originNo],
        ['📅 تاریخ', data.originDate ? `${data.originDate.day}/${data.originDate.month}/${data.originDate.year}` : ''],
        ['🏢 فرستنده', data.sender],
        ['📋 موضوع', data.subject],
    ].filter(([,v]) => v);
    c.innerHTML = rows.map(([l,v]) => `<div class="ai-data-row"><span class="ai-data-label">${l}:</span><span class="ai-data-value">${v}</span></div>`).join('');
    c.style.display = 'block';
}

function showNotification(message, type = 'info') {
    document.getElementById('ai-autoimport-notif')?.remove();
    const n = document.createElement('div');
    n.id = 'ai-autoimport-notif';
    n.className = `ai-notif ai-notif-${type}`;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 5000);
}

// ===================================================
// ۱۰. Observer
// ===================================================
let _debounce = null;
new MutationObserver(() => {
    if (_debounce) clearTimeout(_debounce);
    _debounce = setTimeout(detectPageAndInject, 400);
}).observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detectPageAndInject);
} else {
    detectPageAndInject();
}

// ===================================================
// ۱۱. تأیید خودکار دیالوگ‌ها
// ===================================================
let _autoConfirmEnabled = false;
let _modalObserver = null;
const SCRIPT_ID = 'ai-autoconfirm-script';

function enableAutoConfirm() {
    if (_autoConfirmEnabled) return;
    _autoConfirmEnabled = true;

    // Observer برای دیالوگ‌های HTML/modal
    _modalObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) autoClickDialogButtons(node);
            }
        }
    });
    if (document.body) {
        _modalObserver.observe(document.body, { childList: true, subtree: true });
    }

    aiLogger.info('Auto-confirm enabled');
}

function disableAutoConfirm() {
    if (!_autoConfirmEnabled) return;
    _autoConfirmEnabled = false;
    
    if (_modalObserver) { _modalObserver.disconnect(); _modalObserver = null; }
    aiLogger.info('Auto-confirm disabled');
}

function autoClickDialogButtons(node) {
    if (!isDialogLike(node)) return;
    const yesTexts = ['بله', 'بلی', 'yes', 'ok', 'تایید', 'تأیید', 'موافق', 'قبول', 'ادامه', 'confirm'];
    const buttons = node.querySelectorAll ?
        node.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, .btn') : [];
    for (const btn of buttons) {
        const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
        if (yesTexts.some(t => txt.includes(t))) {
            setTimeout(() => { btn.click(); aiLogger.info('✅ Auto-clicked:', txt); }, 10);
            return;
        }
    }
}

function isDialogLike(node) {
    if (!node || node.nodeType !== 1) return false;
    // SweetAlert
    if (node.classList?.contains('swal2-container') || node.classList?.contains('swal-overlay')) return true;
    // Modal
    if (node.classList?.contains('modal') || node.getAttribute('role') === 'dialog' ||
        node.getAttribute('role') === 'alertdialog') return true;
    if (node.id?.toLowerCase().includes('modal') || node.id?.toLowerCase().includes('dialog')) return true;
    if (node.className?.includes?.('overlay') || node.className?.includes?.('popup') ||
        node.className?.includes?.('Popup') || node.className?.includes?.('notification') ||
        node.className?.includes?.('MessageBox') || node.className?.includes?.('confirm')) return true;
    // High z-index fixed/absolute
    try {
        const style = window.getComputedStyle(node);
        const z = parseInt(style.zIndex);
        if ((style.position === 'fixed' || style.position === 'absolute') && z > 1000) return true;
    } catch (e) {}
    return false;
}

// خواندن تنظیم auto-confirm از storage
(async function loadAutoConfirmSetting() {
    try {
        const stored = await chrome.storage.local.get(['autoimport_autoconfirm']);
        if (stored.autoimport_autoconfirm) enableAutoConfirm();
    } catch (e) {}
})();

chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoimport_autoconfirm) {
        changes.autoimport_autoconfirm.newValue ? enableAutoConfirm() : disableAutoConfirm();
    }
});

aiLogger.info('AutoImport AI content script v3 loaded');

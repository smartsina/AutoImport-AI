// ===== AutoImport AI - Content Script (v2) =====
// جریان کار: لیست ایمیل → receivexml parsing → فرم وارده → پر کردن + ذخیره + ارجاع

// ===== تأیید خودکار دیالوگ‌ها: از طریق MAIN world در background.js انجام می‌شود =====
// (تزریق inline script به دلیل CSP سایت بلاک می‌شود؛ به جای آن از MutationObserver استفاده می‌کنیم)

const aiLogger = {
    info: (msg, data = null) => console.log(`[AutoImport CS] ${msg}`, data || ''),
    error: (msg, err = null) => console.error(`[AutoImport CS] ${msg}`, err || ''),
    warn: (msg, data = null) => console.warn(`[AutoImport CS] ${msg}`, data || '')
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
    } catch (e) { }
})();

function isEmailListPage() {
    return !!(document.getElementById('ResultsTable') ||
              document.querySelector('table.EmailGeneralFarsiTable2'));
}

// ===================================================
// ۱. تشخیص نوع صفحه و تزریق مناسب
// ===================================================
function detectPageAndInject() {
    // صفحه لیست ایمیل (صندوق ورودی)
    if (isEmailListPage()) {
        injectEmailListButton();
        startRegistrationTabWatcher();

        // جلوگیری از اجرای مکرر بخاطر MutationObserver
        if (window._pageStateInitialized) return;
        window._pageStateInitialized = true;

        // چک کردن برای از سرگیری ثبت گروهی در صورت رفرش شدن صفحه
        chrome.storage.local.get([
            'autoimport_batch_active', 'autoimport_batch_queue', 'autoimport_batch_total',
            'autoimport_batch_paused', 'autoimport_batch_waiting', 'autoimport_batch_wait_time'
        ]).then(stored => {
            if (stored.autoimport_batch_active && stored.autoimport_batch_queue && stored.autoimport_batch_queue.length > 0) {
                window.isBatchProcessing = true;
                window.autoImportQueue = stored.autoimport_batch_queue;
                window.batchTotal = stored.autoimport_batch_total || stored.autoimport_batch_queue.length;
                window.isBatchPaused = stored.autoimport_batch_paused || false;
                aiLogger.info('Resuming batch processing from storage. Queue length:', window.autoImportQueue.length);

                showBatchPanel(window.batchTotal);
                updateBatchPanelProgress(window.batchTotal, window.autoImportQueue.length);

                if (window.isBatchPaused) {
                    const btn = document.getElementById('ai-batch-pause-btn');
                    if (btn) {
                        btn.innerHTML = '▶️ ادامه ثبت گروهی';
                        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                    }
                    const statusEl = document.getElementById('ai-batch-status');
                    if (statusEl) statusEl.textContent = 'وضعیت: متوقف شده';
                }

                // فقط در صورتی به نامه بعدی برو که منتظر اتمام نامه فعلی نباشیم (یا تایم‌اوت ۱۸۰ ثانیه‌ای/۳ دقیقه‌ای شده باشد) و پاز نباشد
                const isWaiting = stored.autoimport_batch_waiting;
                const waitTime = stored.autoimport_batch_wait_time || 0;
                const isTimeout = (Date.now() - waitTime) > 180000;

                if (!window.isBatchPaused && (!isWaiting || isTimeout)) {
                    window.batchIsBusy = false;
                    setTimeout(processNextBatchItem, 1500);
                } else if (isWaiting && !isTimeout) {
                    aiLogger.info('Batch is waiting for current form to finish...');
                }
            } else {
                // چک کردن حالت تخلیه اتوماتیک
                chrome.storage.local.get(['autoimport_autoempty_active']).then(emptyStored => {
                    if (emptyStored.autoimport_autoempty_active) {
                        aiLogger.info('Auto-empty is active. Checking for new letters after reload.');
                        showAutoEmptyOverlay();
                        // تأخیر کوتاه برای اطمینان از لود شدن کامل لیست
                        setTimeout(() => {
                            handleAutoEmptyImport(true);
                        }, 3000);
                    }
                }).catch(e => {});
            }
        }).catch(e => {
            if (e.message && e.message.includes('Extension context invalidated')) return;
            aiLogger.error('Storage error:', e);
        });

        return;
    }

    // صفحه فرم وارده (ثبت نامه)
    if (document.getElementById('ulSave') || document.getElementById('ulSend') ||
        document.getElementById('txtImportOriginNO')) {
        
        // جلوگیری از اجرای مکرر فرم بخاطر MutationObserver
        if (window._formStateInitialized) return;
        window._formStateInitialized = true;

        // شنوندگان زودهنگام بستن دستی پنجره/تب برای عدم توقف صف ثبت جمعی
        setupRegistrationTabCloseListeners();

        injectImportFormButton();
        checkAndAutoFillFromStorage();

        // چک کردن برای حالت ثبت گروهی (Batch)
        chrome.storage.local.get(['autoimport_batch_active']).then(stored => {
            if (stored.autoimport_batch_active) {
                aiLogger.info('Batch import is active, auto-starting startFormAutoImport...');
                setTimeout(() => startFormAutoImport(false), 1500);
            }
        }).catch(e => {});

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
    btnContainer.innerHTML = buildButtonHTML('ثبت جمعی وارده', 'batch-import-btn') + buildButtonHTML('تخلیه اتوماتیک صندوق', 'auto-empty-btn');
    toolbar.appendChild ? toolbar.appendChild(btnContainer) : toolbar.insertAdjacentElement('afterend', btnContainer);

    btnContainer.querySelector('.batch-import-btn').addEventListener('click', handleBatchEmailImport);
    btnContainer.querySelector('.auto-empty-btn').addEventListener('click', handleAutoEmptyImport);
    aiLogger.info('Email list buttons injected');
}

function injectFloatingEmailButton() {
    if (document.getElementById('ai-emaillist-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'ai-emaillist-btn';
    btn.style.cssText = `width: 100%; padding: 6px 10px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: block; box-sizing: border-box; margin-bottom: 10px; z-index: 999;`;
    btn.innerHTML = buildButtonHTML('ثبت جمعی وارده', 'batch-import-btn') + buildButtonHTML('تخلیه اتوماتیک صندوق', 'auto-empty-btn');

    // Inject at the very top of the body
    if (document.body.firstChild) {
        document.body.insertBefore(btn, document.body.firstChild);
    } else {
        document.body.appendChild(btn);
    }

    btn.querySelector('.batch-import-btn').addEventListener('click', handleBatchEmailImport);
    btn.querySelector('.auto-empty-btn').addEventListener('click', handleAutoEmptyImport);
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

function buildButtonHTML(label, extraClass = '') {
    return `
    <button type="button" class="ai-smart-btn ${extraClass}" style="
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

// --- توابع ثبت جمعی (Batch Import) ---
window.autoImportQueue = [];
window.isBatchProcessing = false;

async function handleBatchEmailImport() {
    if (window.isBatchProcessing) {
        showNotification('⏳ در حال پردازش جمعی...', 'warning');
        return;
    }

    // پیدا کردن تمام چک‌باکس‌های تیک‌خورده در جدول ResultsTable (فیلتر ردیف‌های نامعتبر و chkAll)
    const checkboxes = Array.from(document.querySelectorAll('#ResultsTable tr input[type="Checkbox"], #ResultsTable tr input[type="checkbox"]'))
        .filter(cb => {
            if (!cb.checked) return false;
            if (cb.id === 'chkAll' || cb.id.includes('All') || cb.closest('th') || cb.closest('thead')) return false;
            const tr = cb.closest('tr');
            if (!tr || tr.querySelector('th')) return false;
            return !!(tr.querySelector('.SearchMenuButton') || tr.getAttribute('receivexml'));
        });

    // بررسی تنظیمات بازیافت رسیدها
    const settings = await chrome.storage.local.get(['autoimport_recycle_receipts']);
    const recycleReceipts = !!settings.autoimport_recycle_receipts;

    // استخراج شناسه‌های منحصر به فرد و بررسی رسید بودن
    let receiptsToRecycle = [];
    let lettersToProcess = [];

    const selectedKeys = checkboxes.map(cb => {
        const tr = cb.closest('tr');
        const cbId = (cb.value && cb.value !== 'on') ? cb.value : (cb.id && cb.id !== 'on' ? cb.id : null);
        const xmlStr = tr ? (tr.getAttribute('receivexml') || '') : '';
        const emailData = xmlStr ? parseReceiveXML(xmlStr) : null;
        const textKey = xmlStr ? xmlStr.substring(0, 200) : (tr ? tr.innerText.trim().replace(/\s+/g, ' ').substring(0, 60) : '');

        const isReceipt = xmlStr.includes('رسید خواندن') || xmlStr.includes('رسيد خواندن') || xmlStr.includes('رسید ایمیل') || (tr && (tr.innerText.includes('رسید خواندن') || tr.innerText.includes('رسيد خواندن') || tr.innerText.includes('رسید ایمیل')));
        const keyObj = {
            cbId,
            textKey,
            subject: emailData?.subject || '',
            sender: emailData?.senderName || '',
            docNum: emailData?.documentNumber || ''
        };

        if (recycleReceipts && isReceipt) {
            receiptsToRecycle.push({ cb, keyObj });
        } else {
            lettersToProcess.push({ cb, keyObj });
        }

        return keyObj;
    });

    // اگر رسید خوانی برای بازیافت وجود دارد
    if (receiptsToRecycle.length > 0) {
        showNotification(`در حال انتقال ${receiptsToRecycle.length} رسید خواندن به بازیافت...`, 'info');

        // نامه‌های باقی‌مانده را در ذخیره می‌گذاریم تا بعد از رفرش ادامه دهد
        const remainingKeys = lettersToProcess.map(item => item.keyObj);
        if (remainingKeys.length > 0) {
            await chrome.storage.local.set({
                autoimport_batch_active: true,
                autoimport_batch_queue: remainingKeys,
                autoimport_batch_total: remainingKeys.length
            });
        }

        // تیک نامه‌هایی که رسید نیستند را برمی‌داریم تا پاک نشوند
        lettersToProcess.forEach(item => {
            if (item.cb) item.cb.checked = false;
        });

        // کلیک روی دکمه بازیافت
        const deleteBtn = document.getElementById('InVisibleBtn');
        if (deleteBtn) {
            deleteBtn.click();
            return; // توقف و صبر برای رفرش شدن صفحه
        } else {
            showNotification('دکمه بازیافت (InVisibleBtn) پیدا نشد!', 'error');
            // ادامه با روال عادی اگر دکمه پیدا نشد
        }
    }

    const keysToProcess = recycleReceipts ? lettersToProcess.map(item => item.keyObj) : selectedKeys;

    if (keysToProcess.length === 0) {
        showNotification('⚠️ هیچ نامه‌ای برای ثبت گروهی انتخاب نشده است.', 'warning');
        return;
    }

    window.autoImportQueue = keysToProcess;
    window.batchTotal = keysToProcess.length;
    window.isBatchProcessing = true;
    await chrome.storage.local.set({
        autoimport_batch_active: true,
        autoimport_batch_queue: keysToProcess,
        autoimport_batch_total: keysToProcess.length
    });

    showNotification(`شروع پردازش جمعی برای ${keysToProcess.length} نامه...`, 'info');
    showBatchPanel(keysToProcess.length);
    updateBatchPanelProgress(keysToProcess.length, keysToProcess.length);

    processNextBatchItem();
}

// --- توابع تخلیه اتوماتیک صندوق ---
let autoEmptyIntervalId = null;

async function handleAutoEmptyImport(isResuming = false) {
    if (window.isBatchProcessing && !isResuming) {
        showNotification('⏳ در حال پردازش جمعی...', 'warning');
        return;
    }

    try {
        await chrome.storage.local.set({ autoimport_autoempty_active: true });
    } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) return;
        aiLogger.error('Storage set error:', e);
    }

    // انتخاب فقط ردیف‌های نامه‌ها (بدون سرستون یا chkAll)
    const checkboxes = Array.from(document.querySelectorAll('#ResultsTable tr input[type="Checkbox"], #ResultsTable tr input[type="checkbox"]'))
        .filter(cb => {
            if (cb.id === 'chkAll' || cb.id.includes('All') || cb.closest('th') || cb.closest('thead')) return false;
            const tr = cb.closest('tr');
            if (!tr || tr.querySelector('th')) return false;
            return !!(tr.querySelector('.SearchMenuButton') || tr.getAttribute('receivexml'));
        });

    if (checkboxes.length === 0) {
        // هیچ نامه‌ای نیست، منتظر بمان و رفرش کن
        triggerAutoEmptyWait();
        return;
    }

    // انتخاب تمام نامه‌ها
    checkboxes.forEach(cb => cb.checked = true);
    
    showAutoEmptyOverlay();

    // شروع ثبت جمعی
    handleBatchEmailImport();
}

// --- ابزار شناور و قابل جابه‌جا کردن پاپ‌آپ‌ها (Draggable) ---
function makeDraggable(panel, handle = null) {
    if (!panel || panel.dataset.aiDraggable === 'true') return;
    panel.dataset.aiDraggable = 'true';

    const dragHandle = handle || panel.querySelector('.ai-panel-header') || panel;
    dragHandle.style.cursor = 'grab';

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const onMouseDown = (e) => {
        // عدم درگ در صورت کلیک روی دکمه‌ها، فیلدها یا آیکون‌ها
        if (e.target.closest('button, input, select, textarea, a, .ai-smart-btn, #ai-single-close-x, [onclick]')) {
            return;
        }

        isDragging = true;
        dragHandle.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';

        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = rect.left;
        initialTop = rect.top;

        // تبدیل به مختصات عددی دقیق top و left
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';

        e.preventDefault();

        const onMouseMove = (ev) => {
            if (!isDragging) return;
            ev.preventDefault();

            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // محدود کردن به کادر صفحه برای گم نشدن پنل
            const maxLeft = Math.max(10, window.innerWidth - panel.offsetWidth - 10);
            const maxTop = Math.max(10, window.innerHeight - panel.offsetHeight - 10);

            newLeft = Math.max(10, Math.min(newLeft, maxLeft));
            newTop = Math.max(10, Math.min(newTop, maxTop));

            panel.style.left = `${newLeft}px`;
            panel.style.top = `${newTop}px`;
        };

        const onMouseUp = () => {
            isDragging = false;
            dragHandle.style.cursor = 'grab';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
            try {
                if (window.top && window.top !== window) {
                    window.top.document.removeEventListener('mousemove', onMouseMove, true);
                    window.top.document.removeEventListener('mouseup', onMouseUp, true);
                }
            } catch (err) { }
        };

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
        try {
            if (window.top && window.top !== window) {
                window.top.document.addEventListener('mousemove', onMouseMove, true);
                window.top.document.addEventListener('mouseup', onMouseUp, true);
            }
        } catch (err) { }
    };

    dragHandle.addEventListener('mousedown', onMouseDown);
}

function showAutoEmptyOverlay() {
    if (document.getElementById('ai-autoempty-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ai-autoempty-overlay';
    overlay.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: white;
        padding: 15px 25px;
        border-radius: 12px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        z-index: 10000;
        font-family: Tahoma, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        direction: rtl;
        cursor: grab;
        user-select: none;
    `;

    overlay.innerHTML = `
        <div style="font-size: 14px; font-weight: bold; display: flex; align-items: center; gap: 6px;">
            <span>🔄</span> <span>تخلیه اتوماتیک صندوق فعال است</span>
        </div>
        <div id="ai-autoempty-timer" style="font-size: 13px;">در حال بررسی لیست...</div>
        <button id="ai-autoempty-stop-btn" style="
            background: #ef4444;
            color: white;
            border: none;
            padding: 5px 15px;
            border-radius: 6px;
            cursor: pointer;
            font-family: inherit;
        ">توقف عملیات</button>
    `;

    document.body.appendChild(overlay);
    makeDraggable(overlay, overlay);

    document.getElementById('ai-autoempty-stop-btn').addEventListener('click', async () => {
        clearInterval(autoEmptyIntervalId);
        await chrome.storage.local.set({ autoimport_autoempty_active: false });
        hideAutoEmptyOverlay();
        showNotification('تخلیه اتوماتیک متوقف شد.', 'info');
    });
}

function hideAutoEmptyOverlay() {
    const overlay = document.getElementById('ai-autoempty-overlay');
    if (overlay) overlay.remove();
}

async function triggerAutoEmptyWait() {
    let settings = {};
    try {
        settings = await chrome.storage.local.get(['autoimport_autoempty_active', 'autoimport_autoempty_interval']);
    } catch (e) {
        if (e.message.includes('Extension context invalidated')) return;
        throw e;
    }
    if (!settings.autoimport_autoempty_active) return;

    const intervalMinutes = settings.autoimport_autoempty_interval || 5;
    let secondsLeft = intervalMinutes * 60;

    showAutoEmptyOverlay();

    if (autoEmptyIntervalId) {
        clearInterval(autoEmptyIntervalId);
    }

    autoEmptyIntervalId = setInterval(() => {
        const timerEl = document.getElementById('ai-autoempty-timer');
        if (timerEl) {
            const m = Math.floor(secondsLeft / 60);
            const s = secondsLeft % 60;
            timerEl.textContent = `بررسی بعدی در ${m}:${s < 10 ? '0' : ''}${s}`;
        }

        secondsLeft--;

        if (secondsLeft < 0) {
            clearInterval(autoEmptyIntervalId);
            receiveFromSimadAndRefresh(timerEl);
        }
    }, 1000);
}

async function receiveFromSimadAndRefresh(timerEl) {
    if (timerEl) timerEl.textContent = 'در حال ارتباط با تب صندوق...';
    try {
        const parentDoc = window.parent.document;
        
        // Find tabs
        const tabs = Array.from(parentDoc.querySelectorAll('li[id^="TabItem"]'));
        const receiveTab = tabs.find(t => t.innerText.includes('صندوقهای دریافت') || t.innerText.includes('صندوقهاي دریافت'));
        const inboxTab = tabs.find(t => t.innerText.includes('دریافت شده ها') || t.innerText.includes('دريافت شده ها'));
        
        if (receiveTab) {
            const receiveLink = receiveTab.querySelector('a') || receiveTab;
            receiveLink.click();
            aiLogger.info('Switched to Receive Mailboxes tab');
            
            // Wait for iframe to load the new content
            if (timerEl) timerEl.textContent = 'در حال لود صندوق دریافت...';
            await new Promise(r => setTimeout(r, 2000));
        }

        // Find the Receive button recursively
        function findReceiveBtn(doc) {
            const btn = doc.getElementById('ReceiveOperationBtn') || doc.querySelector('[name="ReceiveOperationBtn"]');
            if (btn) return btn;
            
            for (const iframe of doc.querySelectorAll('iframe')) {
                try {
                    if (iframe.contentDocument) {
                        const found = findReceiveBtn(iframe.contentDocument);
                        if (found) return found;
                    }
                } catch(e) {}
            }
            return null;
        }
        
        const receiveBtn = findReceiveBtn(parentDoc);
        if (receiveBtn) {
            const doc = receiveBtn.ownerDocument;
            // Try to find the Simad row
            const rows = Array.from(doc.querySelectorAll('tr'));
            const simadRow = rows.find(r => r.innerText.includes('سیماد') || r.innerText.includes('شبکه دولت'));
            
            let checkedSomething = false;
            if (simadRow) {
                const cb = simadRow.querySelector('input[type="Checkbox"], input[type="checkbox"]');
                if (cb && !cb.checked) {
                    cb.checked = true;
                    if (typeof cb.onclick === 'function') { try { cb.onclick(); } catch(e) {} }
                    checkedSomething = true;
                }
            }
            
            // If simad row not found, just check all checkboxes in the table to be safe
            if (!simadRow) {
                aiLogger.warn('کلمه سیماد پیدا نشد. تمام چک‌باکس‌ها انتخاب می‌شوند.');
                const allCbs = Array.from(doc.querySelectorAll('input[type="Checkbox"], input[type="checkbox"]'));
                for(let cb of allCbs) {
                    if (!cb.checked && cb.id !== 'chkAll') {
                        cb.checked = true;
                        if (typeof cb.onclick === 'function') { try { cb.onclick(); } catch(e) {} }
                        checkedSomething = true;
                    }
                }
            }
            
            aiLogger.info('Triggering Simad Receive...');
            receiveBtn.click();
            
            // Wait for the receive operation to finish
            if (timerEl) timerEl.textContent = 'منتظر اتمام دریافت...';
            await new Promise(r => setTimeout(r, 6000));
        } else {
            aiLogger.warn('دکمه دریافت (ReceiveOperationBtn) پیدا نشد.');
        }

        // Switch back to "دریافت شده ها"
        if (inboxTab) {
            const inboxLink = inboxTab.querySelector('a') || inboxTab;
            inboxLink.click();
            aiLogger.info('Switched back to Inbox tab');
            await new Promise(r => setTimeout(r, 1500));
        }
    } catch (e) {
        aiLogger.error('Error during Simad receive:', e);
    }
    
    if (timerEl) timerEl.textContent = 'در حال رفرش...';
    const refreshBtn = document.getElementById('RefreshActiveFrameBtn') || document.querySelector('[onclick*="RefreshActiveFrame"]');
    if (refreshBtn) {
        refreshBtn.click();
    } else if (typeof window.RefreshActiveFrame === 'function') {
        window.RefreshActiveFrame();
    } else {
        location.reload();
    }
}

// --- نظارت خودکار صفحه لیست بر بسته شدن تب فرم در حالت ثبت جمعی ---
let registrationTabWatcherInterval = null;
let registrationTabObserverAttached = false;

function isElementVisible(el) {
    if (!el) return false;
    try {
        if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
        const style = (el.ownerDocument?.defaultView || window).getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
    } catch (e) {
        return (el.offsetWidth > 0 || el.offsetHeight > 0);
    }
}

function checkIsRegistrationTabOpen() {
    const docsToSearch = [document];
    try { if (window.parent && window.parent.document) docsToSearch.push(window.parent.document); } catch (e) { }
    try { if (window.top && window.top.document && window.top !== window.parent) docsToSearch.push(window.top.document); } catch (e) { }

    for (const doc of docsToSearch) {
        if (!doc) continue;
        try {
            // ۱. بررسی وجود iframe باز و قابل رؤیت که فرم وارده در آن است
            const iframes = Array.from(doc.querySelectorAll('iframe'));
            for (const f of iframes) {
                if (!isElementVisible(f)) continue;
                try {
                    const idoc = f.contentDocument;
                    if (idoc) {
                        if (idoc.getElementById('ulSave') || idoc.getElementById('ulSend') ||
                            idoc.getElementById('txtImportOriginNO') || idoc.getElementById('ai-autoimport-panel')) {
                            return true;
                        }
                    }
                } catch (e) {
                    const src = f.src || f.getAttribute('src') || '';
                    if (src.includes('ImportIndicator') || src.includes('Indicator') || src.includes('ImportDoc')) {
                        return true;
                    }
                }
            }

            // ۲. بررسی وجود تب‌های باز در نوار بالای فرزین که دارای دکمه بستن هستند
            const tabs = Array.from(doc.querySelectorAll('li[id^="TabItem"], div[id^="TabItem"], .tab-item'));
            for (const t of tabs) {
                if (!isElementVisible(t)) continue;

                // تب‌های دائمی فرزین (مثل صندوق دریافت) فاقد دکمه بستن هستند؛ فقط تب‌های اسناد دارای دکمه بستن هستند
                const closeBtn = t.querySelector('button.close, .close, .TabClose, [class*="close" i], [class*="TabClose"], [onclick*="close" i], [title*="بستن"], [id^="btn-"]');
                if (!closeBtn) continue;

                const text = (t.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.includes('دريافت') || text.includes('دریافت') || text.includes('صندوق')) continue;

                if (text.includes('وارده') || text.includes('سند') || text.includes('ثبت')) {
                    return true;
                }
            }
        } catch (e) { }
    }
    return false;
}

function startRegistrationTabWatcher() {
    if (registrationTabWatcherInterval) return;
    aiLogger.info('Registration tab watcher initialized in email list frame.');

    const checkAndAdvance = async () => {
        try {
            if (!isEmailListPage()) return;
            const st = await chrome.storage.local.get([
                'autoimport_batch_active',
                'autoimport_batch_waiting',
                'autoimport_batch_wait_time',
                'autoimport_batch_paused'
            ]);
            if (!st.autoimport_batch_active || !st.autoimport_batch_waiting || st.autoimport_batch_paused) {
                return;
            }

            // حداقل ۳ ثانیه از باز شدن فرم گذشته باشد تا فرصت ایجاد DOM و لود اولیه داشته باشد
            const elapsed = Date.now() - (st.autoimport_batch_wait_time || 0);
            if (elapsed < 3000) return;

            // بررسی آیا تب یا آی‌فریم فرم وارده هنوز در DOM باز است؟
            const isTabOpen = checkIsRegistrationTabOpen();
            if (!isTabOpen) {
                aiLogger.info('🔔 Registration tab closed by user detected! Advancing to next letter...');
                await chrome.storage.local.set({
                    autoimport_batch_waiting: false,
                    autoimport_batch_next: Date.now()
                });
                window.batchIsBusy = false;
                setTimeout(processNextBatchItem, 1000);
            }
        } catch (e) { }
    };

    registrationTabWatcherInterval = setInterval(checkAndAdvance, 1500);

    // رصد آنی بسته شدن تب یا حذف المان با MutationObserver در اسناد والد
    if (!registrationTabObserverAttached) {
        registrationTabObserverAttached = true;
        try {
            const docsToObserve = [];
            if (window.parent && window.parent.document) docsToObserve.push(window.parent.document);
            if (window.top && window.top.document && window.top !== window.parent) docsToObserve.push(window.top.document);

            for (const d of docsToObserve) {
                const obs = new MutationObserver(() => {
                    checkAndAdvance();
                });
                obs.observe(d.body || d.documentElement, { childList: true, subtree: true });
            }
        } catch (e) { }
    }
}

function findMatchingBatchRow(allRows, target) {
    if (!target) return null;

    // سطح ۰: فیلتر سطرهای نامعتبر و سطرهایی که قبلاً پردازش شده‌اند
    const candidateRows = allRows.filter(tr => {
        if (!tr || tr.dataset.aiBatchProcessed === 'true') return false;
        if (tr.querySelector('th') || tr.closest('thead')) return false;
        return true;
    });

    // سطح ۱: تطبیق دقیق با شناسه منحصر به فرد چک‌باکس (cbId)
    if (target.cbId) {
        for (const tr of candidateRows) {
            const cb = tr.querySelector('input[type="Checkbox"], input[type="checkbox"]');
            if (!cb) continue;
            const cbId = (cb.value && cb.value !== 'on') ? cb.value : (cb.id && cb.id !== 'on' ? cb.id : null);
            if (cbId && cbId === target.cbId) return tr;
        }
    }

    // سطح ۲: تطبیق با textKey سطر
    if (target.textKey) {
        for (const tr of candidateRows) {
            const xml = tr.getAttribute('receivexml') || '';
            const textKey = xml ? xml.substring(0, 150) : tr.innerText.trim().replace(/\s+/g, ' ').substring(0, 60);
            if (textKey && (textKey.includes(target.textKey) || target.textKey.includes(textKey))) return tr;
        }
    }

    // سطح ۳: تطبیق با شماره مدرک (docNum)
    if (target.docNum && target.docNum.length > 2) {
        for (const tr of candidateRows) {
            const xml = tr.getAttribute('receivexml') || '';
            if (xml.includes(target.docNum)) return tr;
        }
    }

    // سطح ۴: تطبیق با موضوع نامه (subject)
    if (target.subject && target.subject.length > 3) {
        for (const tr of candidateRows) {
            const xml = tr.getAttribute('receivexml') || '';
            const text = tr.innerText || '';
            if (xml.includes(target.subject) || text.includes(target.subject)) return tr;
        }
    }

    // سطح ۵: سطرهایی که هنوز تیک‌خورده هستند (چک‌باکس فعال توسط کاربر)
    for (const tr of candidateRows) {
        const cb = tr.querySelector('input[type="Checkbox"], input[type="checkbox"]');
        if (cb && cb.checked && cb.id !== 'chkAll') {
            aiLogger.info('Matched row via still-checked checkbox in ResultsTable.');
            return tr;
        }
    }

    return null;
}

async function processNextBatchItem() {
    // فقط فریم دارای لیست ایمیل مجاز به پردازش صف است
    if (!isEmailListPage()) {
        aiLogger.info('Ignoring processNextBatchItem: not the email list frame.');
        return;
    }

    if (window.batchIsBusy) {
        aiLogger.info('Batch process is already busy, ignoring call.');
        return;
    }
    window.batchIsBusy = true;

    try {
        if (window.isBatchPaused) {
            showNotification('ثبت گروهی متوقف شده است. روی دکمه "ادامه" کلیک کنید.', 'warning');
            window.batchIsBusy = false;
            return;
        }

        // همگام‌سازی وضعیت صف از storage
        const storedBatch = await chrome.storage.local.get([
            'autoimport_batch_active',
            'autoimport_batch_queue',
            'autoimport_batch_total',
            'autoimport_batch_waiting',
            'autoimport_batch_wait_time'
        ]);

        if (!storedBatch.autoimport_batch_active) {
            window.isBatchProcessing = false;
            window.batchIsBusy = false;
            return;
        }

        if (storedBatch.autoimport_batch_queue) {
            window.autoImportQueue = storedBatch.autoimport_batch_queue;
            window.batchTotal = storedBatch.autoimport_batch_total || window.autoImportQueue.length;
        }

        // چک کن ببین آیا فرم دیگری هم‌اکنون فعال و در حال پردازش است؟
        if (storedBatch.autoimport_batch_waiting) {
            const elapsed = Date.now() - (storedBatch.autoimport_batch_wait_time || 0);
            if (elapsed < 180000) { // کمتر از ۳ دقیقه
                aiLogger.info('یک نامه هم‌اکنون در حال ثبت و ارجاع است. لغو فراخوانی جدید برای جلوگیری از تداخل.', storedBatch);
                window.batchIsBusy = false;
                return;
            }
        }

        if (!window.autoImportQueue || window.autoImportQueue.length === 0) {
            window.isBatchProcessing = false;
            await chrome.storage.local.set({
                autoimport_batch_active: false,
                autoimport_batch_queue: [],
                autoimport_batch_total: 0,
                autoimport_batch_waiting: false
            });
            document.getElementById('ai-batch-panel')?.remove();
            window.batchIsBusy = false;

            // بررسی تخلیه اتوماتیک
            const settings = await chrome.storage.local.get(['autoimport_autoempty_active']);
            if (settings.autoimport_autoempty_active) {
                triggerAutoEmptyWait();
            } else {
                showNotification('✅ ثبت گروهی تمام نامه‌ها با موفقیت به پایان رسید!', 'success');
            }
            return;
        }

        const target = window.autoImportQueue.shift(); // برداشتن شناسه نامه از صف
        const currentRunId = target.cbId || Date.now().toString();

        // ذخیره صف جدید و وضعیت انتظار
        await chrome.storage.local.set({
            autoimport_batch_queue: window.autoImportQueue,
            autoimport_batch_waiting: true,
            autoimport_batch_wait_time: Date.now(),
            autoimport_current_run_id: currentRunId
        });

        updateBatchPanelProgress(window.batchTotal, window.autoImportQueue.length);
        showNotification(`در حال جستجوی نامه در لیست... (باقیمانده در صف: ${window.autoImportQueue.length})`, 'info');

        let currentRow = null;

        // تلاش برای پیدا کردن ردیف در جدول (ممکن است جدول در حال رفرش باشد، پس چند بار تلاش می‌کنیم)
        for (let attempt = 0; attempt < 10; attempt++) {
            if (!window.isBatchProcessing) {
                aiLogger.info('Batch processing aborted during row search');
                return;
            }
            const allRows = Array.from(document.querySelectorAll('#ResultsTable tr, table.EmailGeneralFarsiTable2 tr'));
            currentRow = findMatchingBatchRow(allRows, target);
            if (currentRow) break;
            await sleep(500); // 0.5s wait for AJAX refresh
        }

        if (!currentRow) {
            aiLogger.warn('Row not found for target:', target);
            showNotification('⚠️ یک نامه در لیست پیدا نشد (احتمالاً بایگانی شده). رفتن به نامه بعدی...', 'warning');
            await chrome.storage.local.set({ autoimport_batch_waiting: false });
            setTimeout(processNextBatchItem, 1000);
            return;
        }

        // علامت‌گذاری سطر جاری تا در دورهای بعدی اشتباهاً انتخاب نشود
        currentRow.dataset.aiBatchProcessed = 'true';
        currentRow.classList.add('ai-batch-processed');
        const currentCb = currentRow.querySelector('input[type="Checkbox"], input[type="checkbox"]');
        if (currentCb) currentCb.checked = false;

        // 1. کلیک روی SearchMenuButton
        const menuBtn = currentRow.querySelector('.SearchMenuButton');
        if (!menuBtn) throw new Error('دکمه منو (SearchMenuButton) در این ردیف پیدا نشد.');

        menuBtn.click();
        aiLogger.info('Clicked on SearchMenuButton');

        // 2. صبر برای باز شدن جدول Operations
        let operationsTable = null;
        for (let i = 0; i < 20; i++) {
            if (!window.isBatchProcessing) return;
            await sleep(500);
            operationsTable = document.getElementById('Operations');
            if (operationsTable && operationsTable.offsetParent !== null) break;
        }

        if (!operationsTable) throw new Error('منوی عملیات باز نشد.');

        // 3. کلیک روی "ثبت وارده"
        const importRegIcon = operationsTable.querySelector('.ICON-ImportRegisteration-16X16');
        if (!importRegIcon) throw new Error('گزینه "ثبت وارده" در منو پیدا نشد.');

        const importRegRow = importRegIcon.closest('tr');
        if (importRegRow) importRegRow.click();
        else importRegIcon.click();

        aiLogger.info('Clicked on ثبت وارده in Operations menu');

        // 4. صبر برای باز شدن پاپ‌آپ (iframe)
        let indicatorDiv = null;
        for (let i = 0; i < 20; i++) {
            if (!window.isBatchProcessing) return;
            await sleep(500);
            for (const doc of allDocs()) {
                indicatorDiv = doc.querySelector('.IndicatorSelectionEntityDiv[title="سند وارده"]');
                if (indicatorDiv) break;
            }
            if (indicatorDiv) break;
        }

        if (!indicatorDiv) throw new Error('پاپ‌آپ انتخاب مدرک یا دکمه "سند وارده" پیدا نشد.');

        // 5. کلیک روی دکمه "سند وارده"
        indicatorDiv.click();
        aiLogger.info('Clicked on سند وارده, form tab should open now.');

        // پیام موفقیت برای این نامه
        showNotification('تب ثبت وارده باز شد. منتظر پایان عملیات...', 'success');

        // در این مرحله تب باز است و منتظر سیگنال بسته شدن آن می‌مانیم (توسط رویداد storage)

    } catch (err) {
        aiLogger.error('Batch processing error:', err);
        showNotification(`❌ خطا در باز کردن فرم: ${err.message}`, 'error');
        window.isBatchProcessing = false;
    } finally {
        window.batchIsBusy = false;
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

    const senderName = getAttr('Receives_SenderName');
    const senderEmail = getAttr('Receives_SenderEmailAddress');
    const subject = getAttr('Receives_Subject');
    const bodyText = getAttr('Receives_BodyText');
    const persianDateRaw = getAttr('Receives_Pop3PersianReceiveDate');

    // شماره مدرک (اگر در farzinreceives_indicatordocnumber بود)
    const docNumRaw = getAttr('FarzinReceives_IndicatorDocNumber');

    // پارس تاریخ فارسی (پشتیبانی از هر دو فرمت سال/ماه/روز و روز/ماه/سال)
    const persianDate = parsePersianDateString(persianDateRaw);

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
    const result = await extractAndAnalyzeFiles(baseData);
    const letterData = result.letterData;
    const analysisSuccess = result.analysisSuccess;

    if (!analysisSuccess) {
        updatePanelStep(2, 'error', 'خطا در استخراج فایل‌ها یا هوش مصنوعی (استفاده از اطلاعات پایه)');
    }

    await chrome.storage.local.remove(['autoimport_pending']);
    updatePanelStep(3, 'loading', 'در حال پر کردن فیلدها...');
    await fillFormFields(letterData);

    let check = validateRequiredFields();
    if (!check.isValid) {
        const missing = [];
        if (!check.hasSubject) missing.push('موضوع');
        if (!check.hasOriginNo) missing.push('شماره نامه');
        if (!check.hasSender) missing.push('فرستنده');
        const errMsg = `فیلدهای الزامی (${missing.join(' و ')}) پر نشدند. عملیات ارجاع متوقف شد.`;
        updatePanelStep(3, 'error', `❌ ${errMsg}`);
        showNotification(`❌ ${errMsg}`, 'error');
        // آزاد کردن صف اگر در حالت batch است
        const settings = await chrome.storage.local.get(['autoimport_autoclose']);
        if (settings.autoimport_autoclose) {
            await chrome.storage.local.set({ autoimport_batch_next: Date.now(), autoimport_batch_waiting: false });
            try { chrome.runtime.sendMessage({ action: 'batchNextSignal' }); } catch (e) { }
            await handleAutoCloseTab();
        } else {
            showNotification('❌ عملیات متوقف شد. پنجره را ببندید تا ادامه یابد.', 'error');
            const tabCloseBtn = findTabCloseButton();
            const sendSignal = async () => {
                await chrome.storage.local.set({ autoimport_batch_next: Date.now(), autoimport_batch_waiting: false });
                try { chrome.runtime.sendMessage({ action: 'batchNextSignal' }); } catch (e) { }
            };
            if (tabCloseBtn) {
                tabCloseBtn.addEventListener('click', sendSignal, { once: true });
            } else {
                window.addEventListener('beforeunload', sendSignal, { once: true });
            }
        }
        return; // توقف عملیات
    }

    updatePanelStep(3, 'done', 'فیلدها پر شدند ✓');
    await executeAutoSaveAndSend();

    // بستن خودکار / سیگنال batch بعد از اتمام (مشابه startFormAutoImport)
    const settings = await chrome.storage.local.get(['autoimport_autoclose']);
    if (settings.autoimport_autoclose) {
        await chrome.storage.local.set({ autoimport_batch_next: Date.now(), autoimport_batch_waiting: false });
        try { chrome.runtime.sendMessage({ action: 'batchNextSignal' }); } catch (e) { }
        await handleAutoCloseTab();
    } else {
        showNotification('✅ نامه ثبت شد. برای ادامه، دکمه زیر را بزنید یا تب را ببندید.', 'info');
        showReviewAndNextButton();
        const tabCloseBtn = findTabCloseButton();
        const sendSignal = async () => {
            await chrome.storage.local.set({ autoimport_batch_next: Date.now(), autoimport_batch_waiting: false });
            try { chrome.runtime.sendMessage({ action: 'batchNextSignal' }); } catch (e) { }
        };
        if (tabCloseBtn) {
            tabCloseBtn.addEventListener('click', sendSignal, { once: true });
        } else {
            window.addEventListener('beforeunload', sendSignal, { once: true });
        }
    }
}

// --- ترکیب داده‌های ایمیل و OCR ---
function mergeData(base, ocr) {
    return {
        originNo: normalizeLetterNumber(ocr.originNo || base.originNo || ''),
        originDate: ocr.originDate || base.originDate || null,
        sender: base.sender || ocr.sender || '',  // ایمیل اولویت دارد
        senderEmail: base.senderEmail || ocr.senderEmail || '',
        subject: ocr.subject || base.subject || '',
        description: ocr.description || base.description || '',
        keywords: ocr.keywords || '',
        rawText: ocr.rawText || ''
    };
}

async function checkPause() {
    while (window.isSinglePaused) {
        await sleep(500);
    }
}

// ===================================================
// استخراج و آنالیز فایل‌های ضمیمه (outer scope — قابل دسترس از هر جا)
// ===================================================
async function extractAndAnalyzeFiles(letterData) {
    let analysisSuccess = false;

    updatePanelStep(3, 'loading', 'در حال باز کردن منوی فایل‌های ضمیمه...');

    let scannedDiv = null;
    let foundDoc = null;
    let dependencyOpened = false;

    for (let i = 0; i < 30; i++) {
        // ۱. بررسی می‌کنیم که آیا منوی پیوست‌ها (ScannedImages) باز شده است یا خیر
        for (const doc of allDocs()) {
            const div = doc.getElementById('ScannedImages');
            if (div && div.innerHTML.includes('DownLoad_OnClick')) {
                scannedDiv = div;
                foundDoc = doc;
                break;
            }
        }

        if (scannedDiv) {
            aiLogger.info('✅ ScannedImages found on attempt ' + (i + 1));
            dependencyOpened = true;
            break;
        }

        // ۲. اگر هنوز باز نشده، سعی می‌کنیم روی دکمه زنجیره کلیک کنیم
        for (const doc of allDocs()) {
            const depBtn = doc.getElementById('ulDependency');
            if (depBtn) {
                try { depBtn.click(); } catch (e) { }
                break;
            }
        }

        updatePanelStep(3, 'loading', `در حال انتظار برای لود زنجیره مدرک... (تلاش ${i + 1} از 30)`);
        await sleep(1000);
    }

    if (!dependencyOpened) {
        aiLogger.warn('دکمه زنجیره مدرک یا منوی پیوست‌ها پیدا نشد.');
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

    if (allFiles.length === 0) {
        allFiles = getAllFileUrls().map(f => ({ type: 'url', url: f.url, label: f.label }));
    }

    aiLogger.info(`📂 Found ${allFiles.length} file(s):`, allFiles.map(f => f.label));

    if (allFiles.length > 10) {
        aiLogger.info(`Found ${allFiles.length} files, but limiting to first 10.`);
        allFiles = allFiles.slice(0, 10);
    }

    if (allFiles.length > 0) {
        updatePanelStep(3, 'loading', `آماده دانلود بومی ${allFiles.length} فایل ضمیمه...`);
        try {
            const downloadedFiles = await downloadAndConvertFiles(allFiles, foundDoc || document);
            const validFiles = downloadedFiles.filter(f => f.success && f.text);

            if (validFiles.length > 0) {
                updatePanelStep(3, 'loading', `در حال استخراج ساختار نامه با مدل محلی LM Studio (Qwen 3.5)...`);

                let combinedText = '';
                let aiPromptText = '';
                for (let i = 0; i < validFiles.length; i++) {
                    const rawFileText = (validFiles[i].text || '').trim();
                    combinedText += `\n\n--- [${validFiles[i].label}] ---\n${rawFileText}`;

                    // برای پرامپت هوش مصنوعی، فایل‌های حجیم خلاصه می‌شوند تا پنجره بافت سرریز نکند
                    let boundedText = rawFileText;
                    if (boundedText.length > 10000) {
                        boundedText = boundedText.substring(0, 8000) + '\n\n... [ادامه صفحات این ضمیمه خلاصه شد] ...\n\n' + boundedText.substring(boundedText.length - 2000);
                    }
                    aiPromptText += `\n\n--- [${validFiles[i].label}] ---\n${boundedText}`;
                }

                if (aiPromptText.length > 22000) {
                    aiPromptText = aiPromptText.substring(0, 18000) + '\n\n... [بخشی از پیوست‌های طولانی خلاصه شد] ...\n\n' + aiPromptText.substring(aiPromptText.length - 3500);
                }

                let ocrRes = null;
                try {
                    aiLogger.info('Sending combined OCR text to background ocrAndAnalyzeLetter...', aiPromptText.length);
                    ocrRes = await chrome.runtime.sendMessage({
                        action: 'ocrAndAnalyzeLetter',
                        payload: { extractedText: aiPromptText, baseData: letterData }
                    });
                    aiLogger.info('Received ocrAndAnalyzeLetter response:', ocrRes);
                } catch (sendErr) {
                    aiLogger.error('chrome.runtime.sendMessage failed:', sendErr);
                    ocrRes = { success: false, error: sendErr.message };
                }

                if (ocrRes && ocrRes.success && ocrRes.data) {
                    letterData = mergeData(letterData, ocrRes.data);
                    if (combinedText) {
                        letterData.description = (letterData.description || '') + '\n\nمتن استخراج شده:\n' + combinedText;
                    }
                    analysisSuccess = true;
                    showExtractedData(letterData, validFiles.map(f => f.label).join(', '));
                    updatePanelStep(3, 'done', `آنالیز هوش مصنوعی کامل شد ✓ (شماره: ${letterData.originNo || '-'})`);
                } else {
                    if (combinedText) {
                        letterData.description = (letterData.description || '') + '\n\nمتن استخراج شده:\n' + combinedText;
                    }
                    const errMsg = (ocrRes && ocrRes.error) || 'عدم پاسخ یا تایم‌اوت مدل محلی LM Studio';
                    aiLogger.warn('ocrAndAnalyzeLetter failed:', errMsg);
                    updatePanelStep(3, 'error', `خطای هوش مصنوعی: ${errMsg}`);
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
            const docsToSearch = [window.document, window.parent.document];
            if (window.top !== window.parent) docsToSearch.push(window.top.document);
            let closed = false;
            for (const doc of docsToSearch) {
                try {
                    const closeBtns = Array.from(doc.querySelectorAll('.ui-dialog-titlebar-close, [title="Close"], .fancybox-close, #btnClose'));
                    for (const btn of closeBtns) {
                        if (btn.offsetWidth > 0 || btn.offsetHeight > 0) {
                            btn.click();
                            closed = true;
                        }
                    }
                } catch (e) {}
            }
            if (!closed) {
                const dialogs = window.parent.document.querySelectorAll('.ui-dialog');
                dialogs.forEach(d => { if (d.style.display !== 'none') d.style.display = 'none'; });
            }
        } catch (e) { }
    }

    return { letterData, analysisSuccess };
}

// --- شروع از داخل فرم (جریان جدید: گیرنده → ذخیره → OCR → پر کردن → ذخیره → ارجاع) ---
async function startFormAutoImport(eventOrFlag) {
    if (isProcessing) { showNotification('⏳ در حال پردازش...', 'warning'); return; }
    
    const isManualClick = eventOrFlag instanceof Event || eventOrFlag === true;

    const storedRunId = await chrome.storage.local.get(['autoimport_current_run_id']);
    const runId = storedRunId.autoimport_current_run_id || 'manual';
    const sessionKey = 'autoimport_ran_' + runId;

    if (!isManualClick) {
        if (sessionStorage.getItem(sessionKey)) {
            aiLogger.info('Auto import already ran in this tab session for runId: ' + runId + '. Skipping to prevent loop.');
            return;
        }
        sessionStorage.setItem(sessionKey, 'true');
    }

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
        } catch (e) { }

        // چک می‌کنیم آیا نامه از نوع "رسید خواندن" است؟
        if (existingData.subject && (existingData.subject.includes('رسید خواندن') || existingData.subject.includes('رسيد خواندن') || existingData.subject.includes('رسید ایمیل'))) {
            aiLogger.info('Read receipt detected from email data, aborting registration.');
            updatePanelStep(1, 'done', 'رسید خواندن تشخیص داده شد، توقف عملیات ✓');
            showNotification('ℹ️ نامه رسید خواندن است. نیازی به ثبت و ارجاع نیست.', 'info');
            await chrome.storage.local.set({
                autoimport_batch_next: Date.now(),
                autoimport_batch_waiting: false
            });
            await handleAutoCloseTab();
            return;
        }

        const updateHeartbeat = async () => {
            try {
                await chrome.storage.local.set({
                    autoimport_batch_waiting: true,
                    autoimport_batch_wait_time: Date.now()
                });
            } catch (e) { }
        };

        await updateHeartbeat();
        updatePanelStep(1, 'done', 'اطلاعات فرم خوانده شد ✓');

        // مرحله ۲: فقط گیرنده (کد ۱۰ + مدیریت اداره کل) را پر کن و ذخیره کن
        await checkPause();
        await updateHeartbeat();
        updatePanelStep(2, 'loading', 'در حال ثبت اولیه‌ (OCR هنوز انجام نشده)...');
        await setReceiverField();
        await clickSave();
        updatePanelStep(2, 'done', 'ثبت اولیه موفق ✓');

        // مرحله ۳: دریافت فایل‌های ضمیمه و آنالیز با هوش مصنوعی
        await checkPause();
        await updateHeartbeat();
        const result = await extractAndAnalyzeFiles(existingData);
        let letterData = result.letterData;
        let analysisSuccess = result.analysisSuccess;

        if (!analysisSuccess) {
            updatePanelStep(3, 'error', 'خطا در آنالیز ضمیمه‌ها (ادامه با دیتای خام)');
        }

        // مرحله ۴: پر کردن تمام فیلدها و اعتبارسنجی
        await checkPause();
        await updateHeartbeat();
        updatePanelStep(4, 'loading', 'در حال پر کردن فیلدها و اعتبارسنجی...');
        await fillFormFields(letterData);

        // 🔍 اعتبارسنجی پر شدن فیلدهای الزامی (موضوع و شماره نامه)
        let check = validateRequiredFields();
        if (!check.isValid) {
            aiLogger.warn('برخی فیلدهای ضروری خالی است. تلاش مجدد برای استخراج و پر کردن...', check);
            updatePanelStep(4, 'loading', '⚠️ فیلدهای ضروری خالی است. تلاش مجدد برای استخراج...');
            showNotification('⚠️ اطلاعات ناقص است. در حال تلاش مجدد...', 'warning');

            await sleep(1500);
            await updateHeartbeat();
            const retryResult = await extractAndAnalyzeFiles(existingData);
            if (retryResult && retryResult.letterData) {
                letterData = retryResult.letterData;
                await fillFormFields(letterData);
            }
            check = validateRequiredFields();
        }

        // 🛑 اگر پس از تلاش مجدد همچنان موضوع یا شماره خالی باشد: ارجاع نده!
        if (!check.isValid) {
            const missing = [];
            if (!check.hasSubject) missing.push('موضوع');
            if (!check.hasOriginNo) missing.push('شماره نامه');
            if (!check.hasSender) missing.push('فرستنده');

            const errMsg = `فیلدهای الزامی (${missing.join(' و ')}) پر نشدند. عملیات متوقف شد.`;
            aiLogger.error(errMsg);
            updatePanelStep(4, 'error', `❌ ${errMsg}`);
            showNotification(`❌ ${errMsg}`, 'error');

            // آزادسازی صف ثبت جمعی برای ادامه سایر نامه‌ها
            await chrome.storage.local.set({
                autoimport_batch_next: Date.now(),
                autoimport_batch_waiting: false
            });
            try {
                chrome.runtime.sendMessage({ action: 'batchNextSignal' });
            } catch (e) { }

            throw new Error(errMsg);
        }

        // فقط در صورت پر بودن موضوع و شماره نامه: ذخیره نهایی
        await updateHeartbeat();
        await clickSave();
        updatePanelStep(4, 'done', 'فیلدها پر شدند و ذخیره شد ✓');

        // مرحله ۵: ارجاع
        await checkPause();
        await updateHeartbeat();
        updatePanelStep(5, 'loading', 'در حال ارجاع...');
        let refName = 'كلاري محسن';
        try {
            const stored = await chrome.storage.local.get(['autoimport_config']);
            if (stored.autoimport_config?.referralPersonName) {
                refName = stored.autoimport_config.referralPersonName;
            }
        } catch (e) { }

        await clickSendAndHandle(refName);
        updatePanelStep(5, 'done', 'نامه ارجاع داده شد ✓');
        showNotification('✅ نامه با موفقیت ثبت و ارجاع داده شد', 'success');

        // بررسی تنظیمات بسته شدن خودکار
        const settings = await chrome.storage.local.get(['autoimport_autoclose']);
        if (settings.autoimport_autoclose) {
            // حالت خودکار: سیگنال فوری + بستن تب
            await chrome.storage.local.set({
                autoimport_batch_next: Date.now(),
                autoimport_batch_waiting: false
            });
            try { chrome.runtime.sendMessage({ action: 'batchNextSignal' }); } catch (e) { }
            await handleAutoCloseTab();
        } else {
            // حالت دستی: سیگنال را موکول به بسته شدن واقعی تب می‌کنیم
            showNotification('✅ نامه ثبت و ارجاع شد. برای ادامه، دکمه زیر را بزنید یا تب را ببندید.', 'info');
            updatePanelStep(5, 'done', '✅ پردازش و ارجاع کامل شد');

            // دکمه تایید و رفتن به نامه بعدی در پنل
            showReviewAndNextButton();

            // ثبت سیگنال به محض بسته شدن تب توسط کاربر (پشتیبان)
            const sendSignalOnClose = async () => {
                await chrome.storage.local.set({
                    autoimport_batch_next: Date.now(),
                    autoimport_batch_waiting: false
                });
                try { chrome.runtime.sendMessage({ action: 'batchNextSignal' }); } catch (e) { }
            };

            // اگر دکمه بستن تب فریم پیدا شد، روی آن listener بگذار
            const tabCloseBtn = findTabCloseButton();
            if (tabCloseBtn) {
                tabCloseBtn.addEventListener('click', sendSignalOnClose, { once: true });
                aiLogger.info('Tab close button found — batch signal deferred to manual close.');
            } else {
                // fallback: beforeunload فریم (اگر تب به شکل window/iframe بسته می‌شود)
                window.addEventListener('beforeunload', sendSignalOnClose, { once: true });
                // همچنین اگر storage را watch کنیم و تب مدیریت شود:
                // برای اطمینان از این‌که اگر ۳ دقیقه گذشت سیگنال ارسال شود (timeout safety)
                setTimeout(async () => {
                    const st = await chrome.storage.local.get(['autoimport_batch_waiting']);
                    if (st.autoimport_batch_waiting) {
                        aiLogger.warn('Auto-close is OFF but 3min passed — sending batch signal as safety timeout.');
                        await sendSignalOnClose();
                    }
                }, 180000);
            }
        }

    } catch (err) {
        aiLogger.error('startFormAutoImport error:', err);
        showNotification('❌ خطا: ' + err.message, 'error');
        updateCurrentStepError(err.message);

        // در صورت بروز خطا هم به صندوق اطلاع می‌دهیم تا صف متوقف نشود
        await chrome.storage.local.set({
            autoimport_batch_next: Date.now(),
            autoimport_batch_waiting: false
        });
        try {
            chrome.runtime.sendMessage({ action: 'batchNextSignal' });
        } catch (e) { }
    } finally {
        isProcessing = false;
    }
}

function validateRequiredFields() {
    const subjectEl = document.getElementById('txtSubject_tbxAutocomplete');
    const originNoEl = document.getElementById('txtImportOriginNO');
    const senderEl = document.getElementById('Sender_tbxAutocomplete');

    const subject = subjectEl ? subjectEl.value.trim() : '';
    const originNo = originNoEl ? originNoEl.value.trim() : '';
    const sender = senderEl ? senderEl.value.trim() : '';

    const hasSubject = subject.length > 0;
    const hasOriginNo = originNo.length > 0;
    const hasSender = sender.length > 0;

    return {
        isValid: hasSubject && hasOriginNo && hasSender,
        hasSubject,
        hasOriginNo,
        hasSender,
        subject,
        originNo,
        sender
    };
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
        originDate = parsePersianDateString(`${yearEl.value}/${monthEl.value}/${dayEl.value}`);
    }

    const subjectEl = document.getElementById('txtSubject_tbxAutocomplete');
    const subject = subjectEl ? subjectEl.value.trim() : '';

    // توجه: مقادیر پیش‌فرض فرم نباید مانع استخراج تاریخ دقیق سند پیوست توسط OCR شود
    const isFullyFilled = !!(originNo && subject && senderName);

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

// --- اعلان بسته شدن فرم به سیستم ثبت جمعی ---
function notifyBatchTabClosed() {
    if (window._batchSignalSent) return;
    window._batchSignalSent = true;
    aiLogger.info('Notifying batch: registration tab closed or closing.');
    try {
        chrome.storage.local.set({
            autoimport_batch_waiting: false,
            autoimport_batch_next: Date.now()
        });
    } catch (e) { }
    try {
        chrome.runtime.sendMessage({ action: 'batchNextSignal' });
    } catch (e) { }
}

function setupRegistrationTabCloseListeners() {
    try {
        chrome.runtime.sendMessage({ action: 'registerFormTab' }).catch(() => {});
    } catch (e) { }

    window.addEventListener('beforeunload', notifyBatchTabClosed);
    window.addEventListener('pagehide', notifyBatchTabClosed);
    window.addEventListener('unload', notifyBatchTabClosed);

    // اتصال فوری به دکمه بستن تب در فریم والد
    const attachToTabCloseBtn = () => {
        const closeBtn = findTabCloseButton();
        if (closeBtn) {
            closeBtn.addEventListener('click', notifyBatchTabClosed, { capture: true, once: true });
            aiLogger.info('Attached early close listener to tab close button.');
        }
    };
    attachToTabCloseBtn();
    setTimeout(attachToTabCloseBtn, 1000);
    setTimeout(attachToTabCloseBtn, 2500);

    // شنود کلیک روی دکمه‌های بستن در اسناد والد
    const docs = [];
    try { if (window.parent && window.parent.document) docs.push(window.parent.document); } catch (e) { }
    try { if (window.top && window.top.document && window.top !== window.parent) docs.push(window.top.document); } catch (e) { }

    for (const doc of docs) {
        try {
            doc.addEventListener('click', (e) => {
                const btn = e.target.closest('button.close, .close, .TabClose, [class*="close" i], [class*="TabClose"], [onclick*="close" i], [title*="بستن"], [id^="btn-"]');
                if (!btn) return;
                const tab = btn.closest('li, div, a');
                const text = tab ? (tab.textContent || '') : '';
                if (text.includes('وارده') || text.includes('سند') || !text.includes('دریافت')) {
                    notifyBatchTabClosed();
                }
            }, { capture: true });
        } catch (e) { }
    }
}

// --- پیدا کردن دکمه بستن تب وارده (بدون کلیک کردن) ---
function findTabCloseButton() {
    const docsToSearch = [document];
    try { if (window.parent && window.parent.document) docsToSearch.push(window.parent.document); } catch (e) { }
    try { if (window.top && window.top.document && window.top !== window.parent) docsToSearch.push(window.top.document); } catch (e) { }

    const closeBtnSelectors = 'button.close, .close, .TabClose, [class*="close" i], [class*="TabClose"], [onclick*="close" i], [onclick*="Close" i], [title*="بستن"], [id^="btn-"]';

    for (const doc of docsToSearch) {
        if (!doc) continue;
        try {
            const allCloseButtons = Array.from(doc.querySelectorAll(closeBtnSelectors));
            for (const btn of allCloseButtons) {
                const tabContainer = btn.closest('li, div[id^="TabItem"], a') || btn.parentElement;
                if (!tabContainer) continue;
                const tabText = (tabContainer.textContent || '').replace(/\s+/g, ' ').trim();
                if ((tabText.includes('وارده') || tabText.includes('ثبت') || tabText.includes('سند')) &&
                    !tabText.includes('دريافت') && !tabText.includes('دریافت') && !tabText.includes('صندوق')) {
                    return btn;
                }
            }
            // استراتژی ID فریم
            if (window.frameElement) {
                const frameId = window.frameElement.id || (window.frameElement.parentElement ? window.frameElement.parentElement.id : '');
                const tabIdMatch = frameId.match(/\d+/);
                if (tabIdMatch) {
                    const potentialBtn = doc.getElementById('btn-' + tabIdMatch[0]) ||
                        doc.querySelector(`[tabid="${tabIdMatch[0]}"] button.close`) ||
                        doc.querySelector(`[id*="${tabIdMatch[0]}"] ${closeBtnSelectors}`);
                    if (potentialBtn) {
                        return potentialBtn;
                    }
                }
            }
        } catch (e) { }
    }
    return null;
}

async function handleAutoCloseTab(force = false) {
    try {
        const settings = await chrome.storage.local.get(['autoimport_autoclose']);
        if (force || settings.autoimport_autoclose) {
            aiLogger.info(`Attempting to close registration tab (force=${force})...`);
            const closeBtn = findTabCloseButton();
            if (closeBtn) {
                aiLogger.info('Registration tab close button found! Clicking in 1.2s...');
                setTimeout(() => {
                    try {
                        closeBtn.click();
                        closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window.top }));
                    } catch (err) {
                        aiLogger.warn('Error clicking close button:', err);
                    }
                }, 1200);
            } else {
                aiLogger.warn('Could not find registration tab close button. Trying window.close()...');
                try { window.close(); } catch (e) { }
            }
        } else {
            aiLogger.info('Auto-close setting is OFF.');
        }
    } catch (e) {
        aiLogger.warn('Auto-close error:', e);
    }
}

// ===================================================
// ۴. پر کردن فیلدهای فرم
// ===================================================
async function fillFormFields(data) {
    // شماره اولیه مدرک (کاملاً انگلیسی و چپ‌به‌راست بدون چرخش در مرورگر)
    if (data.originNo) {
        const el = document.getElementById('txtImportOriginNO');
        if (el) {
            const cleanNo = normalizeLetterNumber(data.originNo);
            if (!isDateString(cleanNo)) {
                el.setAttribute('dir', 'ltr');
                el.style.direction = 'ltr';
                el.style.textAlign = 'left';
                setVal(el, cleanNo);
            } else {
                aiLogger.warn('⚠️ ممانعت از ثبت تاریخ در فیلد شماره نامه (originNo):', cleanNo);
            }
        }
    }

    // تاریخ اولیه مدرک (چپ‌به‌راست و ارقام انگلیسی)
    if (data.originDate) {
        let { day, month, year } = data.originDate;
        const norm = parsePersianDateString(`${year}/${month}/${day}`);
        if (norm) {
            day = norm.day;
            month = norm.month;
            year = norm.year;
        }

        // اصلاح خطای فونت نستعلیق ماه 02 به 06 در صورتی که تقویم جاری در شهریور است
        const curJalali = getCurrentJalaliDate();
        if (parseInt(month, 10) === 2 && parseInt(curJalali.month, 10) === 6) {
            aiLogger.info('🔄 تصحیح ماه 02 به 06 در فرم وارده');
            month = '06';
        }

        const validDate = ensureValidPastOrPresentDate({ day, month, year }, curJalali);
        if (validDate) {
            day = validDate.day;
            month = validDate.month;
            year = validDate.year;
        }

        const dayEl = document.getElementById('ViewImportOriginDate_Day');
        const monthEl = document.getElementById('ViewImportOriginDate_Month');
        const yearEl = document.getElementById('ViewImportOriginDate_Year');
        const constEl = document.getElementById('txtOrigionConstYear');

        if (dayEl) {
            dayEl.setAttribute('dir', 'ltr');
            dayEl.style.direction = 'ltr';
            dayEl.style.textAlign = 'center';
            if (day) setVal(dayEl, toEnglishDigits(String(day).padStart(2, '0')));
        }
        if (monthEl) {
            monthEl.setAttribute('dir', 'ltr');
            monthEl.style.direction = 'ltr';
            monthEl.style.textAlign = 'center';
            if (month) setVal(monthEl, toEnglishDigits(String(month).padStart(2, '0')));
        }
        if (yearEl) {
            yearEl.setAttribute('dir', 'ltr');
            yearEl.style.direction = 'ltr';
            yearEl.style.textAlign = 'center';
            if (year) {
                const yStr = String(year);
                const y2 = yStr.length === 4 ? yStr.substring(2) : yStr;
                setVal(yearEl, toEnglishDigits(y2.padStart(2, '0')));
            }
        }
        if (constEl && constEl.value !== '14') {
            constEl.setAttribute('dir', 'ltr');
            constEl.style.direction = 'ltr';
            constEl.style.textAlign = 'center';
            setVal(constEl, '14');
        }

        const mainDateEl = document.getElementById('ViewImportOriginDate');
        if (mainDateEl && mainDateEl !== dayEl && mainDateEl !== monthEl && mainDateEl !== yearEl) {
            const yStr = String(year || '05');
            const y2 = yStr.length === 4 ? yStr.substring(2) : yStr;
            const fullVal = `14${y2.padStart(2, '0')}/${String(month || '01').padStart(2, '0')}/${String(day || '01').padStart(2, '0')}`;
            setVal(mainDateEl, fullVal);
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
    } catch (e) { }

    await clickSendAndHandle(refName);
    updatePanelStep(5, 'done', 'نامه ارجاع داده شد ✓');
    showNotification('✅ نامه با موفقیت ثبت و ارجاع داده شد', 'success');
    // توجه: handleAutoCloseTab و batchNextSignal توسط caller (enrichWithOCR/startFormAutoImport) مدیریت می‌شوند
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
                } catch (fe) { }
            }
        } catch (e) { }

        if (iteration === 10) { // بعد از 5 ثانیه، اسکن در بک‌گراند را هم استارت بزن
            chrome.runtime.sendMessage({ action: 'watchReferralPopup', payload: { refName } }, res => {
                if (res && res.success) {
                    aiLogger.info('Referral found by background scanner!');
                }
            });
        }

        if (iteration % 4 === 0) aiLogger.info(`Waiting for referral popup... (${Math.round((Date.now() - (end - timeout)) / 1000)}s)`);
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
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            el.click();
            return true;
        } catch (e) { return false; }
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
    const okTexts = ['ok', 'تأیید', 'تایید', 'ثبت', 'ارسال', 'ارجاع', 'confirm'];

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

            // ثبت زمان قبل از کلیک جهت جلوگیری از تداخل دانلودهای قبلی یا از دست رفتن دانلود
            const startTime = Date.now() - 1000;

            if (fileInfo.type === 'btn') {
                // کلیک واقعی روی دکمه برای دانلود نیتیو توسط مرورگر
                fileInfo.btn.click();
            } else if (fileInfo.type === 'url') {
                const a = document.createElement('a');
                a.href = fileInfo.url;
                a.download = '';
                a.click();
            }

            // تاخیر کوتاه برای ثبت دانلود در مرورگر
            await sleep(300);

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
        } catch (err) {
            aiLogger.warn(`Failed native download/OCR for ${fileInfo.label}:`, err);
            results.push({ success: false, error: err.message, label: fileInfo.label });
        }
    }
    return results;
}

function getAllFileUrls() {
    const results = [];
    const seen = new Set();

    // تابع کمکی برای ساخت URL کامل
    function resolveUrl(href, baseDoc) {
        if (!href) return null;
        try {
            if (href.startsWith('http')) return href;
            // از origin صفحه‌ای که iframe در آن است
            const base = baseDoc.location?.href || window.location.href;
            return new URL(href, base).href;
        } catch (e) { return null; }
    }

    function scanDoc(doc, depth = 0) {
        if (depth > 5 || !doc) return;

        // ۱. FileTabContent_N — فایل‌های ضمیمه اصلی
        for (const iframe of doc.querySelectorAll('iframe[id^="FileTabContent_"]')) {
            // attribute "url" اولویت دارد چون ticket تازه دارد
            const rawUrl = iframe.getAttribute('url') || iframe.getAttribute('src') || iframe.src || '';
            const fext = (iframe.getAttribute('fileextention') || '').toLowerCase();
            const idx = iframe.getAttribute('index') || iframe.id.replace('FileTabContent_', '');
            const label = `فایل ${toFarsiDigits(idx)}`;

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
                (rawUrl.includes('fileId=') && !rawUrl.includes('DF.aspx'));
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
            } catch (e) { } // cross-origin silently ignored
        }
    }

    // شروع از بالاترین سطح
    try {
        scanDoc(window.top.document);
    } catch (e) {
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
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function toFarsiDigits(str) {
    const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(str).replace(/[0-9]/g, d => p[+d]);
}

function toEnglishDigits(str) {
    if (!str) return '';
    const persian = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const arabic = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    let result = String(str).normalize('NFKD')
        .replace(/ي/g, 'ی')
        .replace(/ك/g, 'ک')
        .replace(/ة/g, 'ه');
    for (let i = 0; i < 10; i++) {
        result = result.replace(new RegExp(persian[i], 'g'), i).replace(new RegExp(arabic[i], 'g'), i);
    }
    return result;
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
        if (typeof aiLogger !== 'undefined') {
            aiLogger.warn(`⚠️ تاریخ استخراج‌شده (${d}/${m}/${shortY}) بزرگتر از تاریخ امروز (${curD}/${curM}/${curShortY}) است. اصلاح هوشمند...`);
        }

        // ۱. بررسی خطای جابجایی ماه و روز (Swap day and month)
        if (m > curM && d <= 12 && m <= 31) {
            const swappedM = d;
            const swappedD = m;
            if (!isAfterToday(shortY, swappedM, swappedD) && swappedM >= 1 && swappedM <= 12 && swappedD >= 1 && swappedD <= 31) {
                m = swappedM;
                d = swappedD;
            }
        }

        // ۲. تصحیح سال در صورتی که سال در آینده تشخیص داده شده باشد (مثلاً 06 به جای 05)
        if (shortY > curShortY && (shortY - curShortY) <= 2) {
            if (!isAfterToday(curShortY, m, d)) {
                shortY = curShortY;
            }
        }

        // ۳. اگر ماه همچنان بعد از ماه جاری است
        if (shortY === curShortY && m > curM) {
            m = curM;
            if (d > curD) d = curD;
        }

        // ۴. اگر در سال و ماه جاری، روز جلوتر از امروز است
        if (shortY === curShortY && m === curM && d > curD) {
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
    return nOrig > 40 && nRev <= 40;
}

function isValidOriginNoCandidate(str) {
    if (!str) return false;
    const s = toEnglishDigits(String(str)).trim();
    // الزماً باید شامل حداقل یک رقم انگلیسی باشد
    if (!/\d/.test(s)) return false;
    // نباید برچسب سازمان/فرستنده/موضوع/متن/صندوق باشد
    if (/^(?:سازمان|فرستنده|موضوع|صندوق|گیرنده|متن|دریافت|پست|email)\b/i.test(s) ||
        s.includes('فرستنده:') || s.includes('سازمان فرستنده') || s.includes('دریافت شده') ||
        s.includes('صندوق') || s.includes('@')) {
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

function parsePersianDateString(raw) {
    if (!raw) return null;
    const clean = toEnglishDigits(String(raw)).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    const parts = clean.match(/\d+/g);
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
    if (numY >= 1200 && numY <= 1299) numY = (numY + 200) % 100;
    else if (numY >= 1300) numY = numY % 100;
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
        } catch (e) {
            rootDoc = document;
        }
    }
    if (!rootDoc) return;
    yield rootDoc;
    for (const f of rootDoc.querySelectorAll('iframe')) {
        try {
            const d = f.contentDocument || f.contentWindow?.document;
            if (d) yield* allDocs(d);
        } catch (e) { }
    }
}

// ===================================================
// ۹. UI پنل پیشرفت
// ===================================================
function showPanel() {
    document.getElementById('ai-autoimport-panel')?.remove();
    window.isSinglePaused = false;
    isProcessing = true; // Ensure isProcessing is true
    const panel = document.createElement('div');
    panel.id = 'ai-autoimport-panel';
    panel.innerHTML = `
        <div class="ai-panel-header">
            <span>🤖 ثبت هوشمند نامه وارده</span>
            <button id="ai-single-close-x">✕</button>
        </div>
        <div class="ai-panel-body">
            <div class="ai-steps">
                ${[[1, '🔍', 'خواندن اطلاعات'], [2, '🧠', 'OCR + آنالیز AI'], [3, '📝', 'پر کردن فیلدها'], [4, '💾', 'ذخیره'], [5, '📤', 'ارجاع']].map(
        ([n, ic, lb]) => `<div class="ai-step" id="ai-step-${n}">
                        <span class="ai-step-icon">${ic}</span>
                        <span class="ai-step-label">${lb}</span>
                        <span class="ai-step-status" id="ai-step-status-${n}">⏳</span>
                    </div>`).join('')}
            </div>
            <div id="ai-extracted-data" style="display:none;"></div>
            <div id="ai-panel-msg" class="ai-panel-message"></div>
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <button id="ai-single-pause-btn" class="ai-smart-btn" style="flex: 1; justify-content:center; background:linear-gradient(135deg, #f59e0b, #d97706);">
                    ⏸ توقف موقت
                </button>
                <button id="ai-single-stop-btn" class="ai-smart-btn" style="flex: 1; justify-content:center; background:linear-gradient(135deg, #ef4444, #b91c1c);">
                    ⏹ پایان
                </button>
            </div>
        </div>`;
    document.body.appendChild(panel);
    makeDraggable(panel, panel.querySelector('.ai-panel-header'));

    const stopOperation = async () => {
        isProcessing = false;
        window.isSinglePaused = false;
        panel.remove();
        showNotification('عملیات متوقف شد.', 'info');
        // اگر batch فعال است، سیگنال آزادسازی بفرست تا صف freeze نشود
        const st = await chrome.storage.local.get(['autoimport_batch_active']);
        if (window.isBatchProcessing || st.autoimport_batch_active) {
            await chrome.storage.local.set({
                autoimport_batch_next: Date.now(),
                autoimport_batch_waiting: false
            });
            try { chrome.runtime.sendMessage({ action: 'batchNextSignal' }); } catch (e) { }
        }
    };

    document.getElementById('ai-single-close-x').addEventListener('click', stopOperation);
    document.getElementById('ai-single-stop-btn').addEventListener('click', stopOperation);

    const pauseBtn = document.getElementById('ai-single-pause-btn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', (e) => {
            window.isSinglePaused = !window.isSinglePaused;
            if (window.isSinglePaused) {
                e.target.innerHTML = '▶️ ادامه فرآیند';
                e.target.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            } else {
                e.target.innerHTML = '⏸ توقف موقت';
                e.target.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            }
        });
    }
}

function showReviewAndNextButton() {
    if (document.getElementById('ai-manual-review-actions')) return;

    const actionContainer = document.createElement('div');
    actionContainer.id = 'ai-manual-review-actions';
    actionContainer.style.cssText = 'margin-top: 12px; display: flex; flex-direction: column; gap: 8px;';
    actionContainer.innerHTML = `
        <button id="ai-btn-proceed-next" class="ai-smart-btn" style="
            width: 100%; justify-content: center; padding: 9px 12px; font-weight: bold; font-size: 13px;
            background: linear-gradient(135deg, #10b981, #059669);
            box-shadow: 0 3px 10px rgba(16, 185, 129, 0.4);
            border: none; border-radius: 6px; color: white; cursor: pointer;
            display: flex; align-items: center; gap: 6px; font-family: Tahoma, sans-serif;">
            <span>➡️</span>
            <span>تایید و رفتن به نامه بعدی (بستن تب)</span>
        </button>
    `;

    const body = document.querySelector('#ai-autoimport-panel .ai-panel-body');
    if (body) body.appendChild(actionContainer);

    document.getElementById('ai-btn-proceed-next')?.addEventListener('click', async () => {
        showNotification('در حال انتقال به نامه بعدی...', 'info');
        await chrome.storage.local.set({
            autoimport_batch_next: Date.now(),
            autoimport_batch_waiting: false
        });
        try { chrome.runtime.sendMessage({ action: 'batchNextSignal' }); } catch (e) { }
        await handleAutoCloseTab(true); // بستن اجباری تب پس از تایید دستی
    });
}

function showBatchPanel(total) {
    if (document.getElementById('ai-batch-panel')) return; // جلوگیری از رفرش پیاپی پنل در صورت وجود

    window.isBatchPaused = false;
    const panel = document.createElement('div');
    panel.id = 'ai-batch-panel';
    panel.innerHTML = `
        <div class="ai-panel-header">
            <span>🤖 وضعیت ثبت گروهی</span>
            <button onclick="this.closest('#ai-batch-panel').remove()">✕</button>
        </div>
        <div class="ai-panel-body" style="text-align:center;">
            <div id="ai-batch-status" style="margin-bottom:10px; font-weight:bold; color:#1e40af;">وضعیت: در حال پردازش...</div>
            <div id="ai-batch-progress" style="margin-bottom:15px; font-size:14px; color:#475569;">
                در انتظار شروع...
            </div>
            <div style="background:#e2e8f0; border-radius:4px; height:8px; width:100%; margin-bottom:15px; overflow:hidden;">
                <div id="ai-batch-progress-bar" style="background:linear-gradient(135deg, #6366f1, #8b5cf6); width:0%; height:100%; transition:width 0.3s;"></div>
            </div>
            <div style="display:flex; gap:10px;">
                <button id="ai-batch-pause-btn" class="ai-smart-btn" style="flex:1; justify-content:center; background:linear-gradient(135deg, #f59e0b, #d97706);">
                    ⏸ توقف موقت
                </button>
                <button id="ai-batch-stop-btn" class="ai-smart-btn" style="flex:1; justify-content:center; background:linear-gradient(135deg, #ef4444, #b91c1c);">
                    ⏹ پایان
                </button>
            </div>
        </div>`;
    document.body.appendChild(panel);
    makeDraggable(panel, panel.querySelector('.ai-panel-header'));

    const pauseBtn = document.getElementById('ai-batch-pause-btn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', async (e) => {
            window.isBatchPaused = !window.isBatchPaused;
            await chrome.storage.local.set({ autoimport_batch_paused: window.isBatchPaused });
            if (window.isBatchPaused) {
                e.target.innerHTML = '▶️ ادامه';
                e.target.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                document.getElementById('ai-batch-status').textContent = 'وضعیت: متوقف شده';
            } else {
                e.target.innerHTML = '⏸ توقف موقت';
                e.target.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
                document.getElementById('ai-batch-status').textContent = 'وضعیت: در حال پردازش...';

                // در صورت وجود نامه در صف و منتظر نبودن، ادامه بده
                const stored = await chrome.storage.local.get(['autoimport_batch_waiting', 'autoimport_batch_wait_time']);
                const isWaiting = stored.autoimport_batch_waiting;
                const waitTime = stored.autoimport_batch_wait_time || 0;
                const isTimeout = (Date.now() - waitTime) > 120000;

                if (!isWaiting || isTimeout) {
                    processNextBatchItem();
                }
            }
        });
    }

    const stopBtn = document.getElementById('ai-batch-stop-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
            window.isBatchProcessing = false;
            window.autoImportQueue = [];
            window.isBatchPaused = false;
            await chrome.storage.local.set({
                autoimport_batch_active: false,
                autoimport_batch_queue: [],
                autoimport_batch_total: 0,
                autoimport_batch_paused: false,
                autoimport_batch_waiting: false,
                autoimport_autoempty_active: false
            });
            hideAutoEmptyOverlay();
            panel.remove();
            showNotification('⏹ ثبت گروهی با موفقیت متوقف شد.', 'info');
        });
    }
}

function updateBatchPanelProgress(total, remaining) {
    const statusEl = document.getElementById('ai-batch-progress');
    const barEl = document.getElementById('ai-batch-progress-bar');
    if (statusEl) {
        const processed = total - remaining;
        statusEl.textContent = `پردازش شده: ${processed} از ${total} (باقی‌مانده: ${remaining})`;
        if (barEl) {
            const percent = total > 0 ? (processed / total) * 100 : 0;
            barEl.style.width = `${percent}%`;
        }
    }
}

function updatePanelStep(n, state, msg) {
    const step = document.getElementById(`ai-step-${n}`);
    const status = document.getElementById(`ai-step-status-${n}`);
    const msgEl = document.getElementById('ai-panel-msg');
    if (step) step.className = `ai-step ai-step-${state}`;
    if (status) status.textContent = { loading: '⏳', done: '✅', error: '❌' }[state] || '⏳';
    if (msgEl) { msgEl.textContent = msg; msgEl.className = `ai-panel-message ai-msg-${state}`; }
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
    ].filter(([, v]) => v);
    c.innerHTML = rows.map(([l, v]) => `<div class="ai-data-row"><span class="ai-data-label">${l}:</span><span class="ai-data-value">${v}</span></div>`).join('');
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
    } catch (e) { }
    return false;
}

// خواندن تنظیم auto-confirm از storage
(async function loadAutoConfirmSetting() {
    try {
        const stored = await chrome.storage.local.get(['autoimport_autoconfirm']);
        if (stored.autoimport_autoconfirm) enableAutoConfirm();
    } catch (e) { }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'triggerNextBatchItem') {
        if (!isEmailListPage()) return; // فقط فریم لیست ایمیل باید صف را مدیریت کند
        chrome.storage.local.get(['autoimport_batch_active', 'autoimport_batch_queue', 'autoimport_batch_paused']).then(stored => {
            if (stored.autoimport_batch_active && stored.autoimport_batch_queue && stored.autoimport_batch_queue.length > 0 && !stored.autoimport_batch_paused) {
                window.isBatchProcessing = true;
                window.autoImportQueue = stored.autoimport_batch_queue;
                window.batchIsBusy = false;
                aiLogger.info('Triggering processNextBatchItem via runtime message signal in list frame...');
                setTimeout(processNextBatchItem, 1000);
            }
        }).catch(() => {});
        sendResponse({ success: true });
        return true;
    }
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoimport_autoconfirm) {
        changes.autoimport_autoconfirm.newValue ? enableAutoConfirm() : disableAutoConfirm();
    }

    // فاز ۳: دریافت سیگنال از فرم تب برای پردازش نامه بعدی در ثبت گروهی
    if (changes.autoimport_batch_next) {
        if (!isEmailListPage()) return; // فقط فریم لیست ایمیل
        chrome.storage.local.get(['autoimport_batch_active', 'autoimport_batch_paused']).then(st => {
            if (st.autoimport_batch_active && !st.autoimport_batch_paused) {
                aiLogger.info('Received batch_next signal in list frame, waiting 1s before next item...');
                window.isBatchProcessing = true;
                window.batchIsBusy = false;
                setTimeout(processNextBatchItem, 1000);
            }
        }).catch(() => {});
    }
});

// ===================================================
// ۱۲. زنده نگه‌داشتن نشست (Keep-Alive)
// ===================================================
function setupKeepAlive() {
    // فقط در صفحاتی که آدرس معتبر دارند اجرا شود (جلوگیری از خطای about:blank در iframeها)
    if (!window.location.href.startsWith('http')) return;
    // برای جلوگیری از اجرای همزمان در ده‌ها فریم، فقط در فریم اصلی اجرا شود
    if (window.top !== window.self) return;

    // هر 5 دقیقه یک درخواست سبک به سرور می‌فرستد تا Session منقضی نشود
    const KEEPALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    setInterval(() => {
        try {
            // استفاده از آدرس فعلی با متد GET به جای تصویر نامشخص
            fetch(window.location.href, { cache: 'no-store' })
                .then(() => aiLogger.info('Keep-alive ping sent.'))
                .catch(() => { /* نادیده گرفتن ارورهای موقت شبکه */ });
        } catch (e) {
            // نادیده گرفتن ارور
        }
    }, KEEPALIVE_INTERVAL);
    aiLogger.info('Session keep-alive initialized (5m interval)');
}

setupKeepAlive();

aiLogger.info('AutoImport AI content script v3 loaded');

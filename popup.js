// ===== AutoImport AI - Popup Script =====

const log = {
    info:  (m, d=null) => console.log(`[Popup] ${m}`, d||''),
    error: (m, e=null) => console.error(`[Popup] ${m}`, e||'')
};

// === نقشه مدل‌ها به endpoint ها ===
const MODEL_OPTIONS = {
    gemini:  { model: 'Gemini-3.1-Pro-Preview', display: 'Gemini 3.1 Pro 👁️', vision: true },
    gptOSS:  { model: 'GPT-OSS-120B',          display: 'GPT-OSS 120B',      vision: false },
    gptMini: { model: 'GPT-5-Mini',             display: 'GPT-5 Mini',        vision: false },
    claude:  { model: 'Claude-Opus-4.7',         display: 'Claude Opus 4.7 👁️', vision: true }
};

let _endpoints = {};

// ===== بارگذاری اولیه =====
document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    await loadStatus();
    await loadConfigForm();
    await loadAddressBookInfo();
    setupAddressBookEvents();
    setupConfigSave();
});

// ===== مدیریت تب‌ها =====
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tab = document.getElementById(`tab-${btn.dataset.tab}`);
            if (tab) tab.classList.add('active');
        });
    });
}

// ===== تب وضعیت =====
async function loadStatus() {
    try {
        const res = await chrome.runtime.sendMessage({ action: 'getConfig' });
        if (res.success && res.data) {
            const cfg = res.data;
            const vModelInfo = Object.values(MODEL_OPTIONS).find(m => m.model === cfg.visionModel);
            const tModelInfo = Object.values(MODEL_OPTIONS).find(m => m.model === cfg.textModel);
            
            document.getElementById('info-model').textContent = vModelInfo ? vModelInfo.display : (cfg.visionModel || 'Gemini-3.1-Pro-Preview');
            document.getElementById('info-text-model').textContent = tModelInfo ? tModelInfo.display : (cfg.textModel || cfg.visionModel || '-');
        }
    } catch (e) { log.error('loadStatus', e); }

    try {
        const res = await chrome.runtime.sendMessage({ action: 'getAddressBook' });
        if (res.success) {
            document.getElementById('info-addressbook').textContent =
                `${res.data.length} سازمان`;
        }
    } catch (e) { log.error('getAddressBook', e); }
}

// ===== تب تنظیمات =====
async function loadConfigForm() {
    try {
        const res = await chrome.runtime.sendMessage({ action: 'getConfig' });
        if (!res.success || !res.data) return;
        const cfg = res.data;

        // ذخیره endpoints برای استفاده بعدی
        _endpoints = cfg.endpoints || {};

        setVal('cfg-apikey', cfg.apiKey || '');

        // پر کردن dropdown ها
        populateModelDropdowns(cfg);

        setVal('cfg-receiver',        cfg.defaultReceiver     || 'مدیریت اداره کل');
        setVal('cfg-receiver-code',   cfg.defaultReceiverCode || '10');
        setVal('cfg-ref-name',        cfg.referralPersonName  || 'كلاري محسن');
        setVal('cfg-ref-role',        cfg.referralPersonRole  || 'مدير كل');

        // تنظیم auto-confirm و auto-close
        const localSettings = await chrome.storage.local.get(['autoimport_autoconfirm', 'autoimport_autoclose', 'autoimport_recycle_receipts', 'autoimport_autoempty_interval']);
        document.getElementById('cfg-autoconfirm').checked = !!localSettings.autoimport_autoconfirm;
        document.getElementById('cfg-autoclose').checked = !!localSettings.autoimport_autoclose;
        document.getElementById('cfg-recycle-receipts').checked = !!localSettings.autoimport_recycle_receipts;
        document.getElementById('cfg-autoempty-interval').value = localSettings.autoimport_autoempty_interval || 5;

    } catch (e) { log.error('loadConfigForm', e); }
}

function populateModelDropdowns(cfg) {
    const visionSelect = document.getElementById('cfg-vision-model');
    const textSelect   = document.getElementById('cfg-text-model');
    const endpoints    = cfg.endpoints || {};

    visionSelect.innerHTML = '';
    textSelect.innerHTML = '';

    for (const [key, info] of Object.entries(MODEL_OPTIONS)) {
        if (!endpoints[key]) continue;

        const vOpt = new Option(info.display, key);
        visionSelect.add(vOpt);

        const tOpt = new Option(info.display, key);
        textSelect.add(tOpt);
    }

    // انتخاب مدل فعلی
    const currentVisionModel = cfg.visionModel || '';
    const currentTextModel   = cfg.textModel || '';

    for (const [key, info] of Object.entries(MODEL_OPTIONS)) {
        if (info.model === currentVisionModel) visionSelect.value = key;
        if (info.model === currentTextModel)   textSelect.value = key;
    }

    // نمایش endpoint ها
    updateEndpointDisplay('cfg-vision-endpoint', endpoints[visionSelect.value]);
    updateEndpointDisplay('cfg-text-endpoint',   endpoints[textSelect.value]);

    // Event listeners
    visionSelect.addEventListener('change', () => {
        updateEndpointDisplay('cfg-vision-endpoint', endpoints[visionSelect.value]);
    });
    textSelect.addEventListener('change', () => {
        updateEndpointDisplay('cfg-text-endpoint', endpoints[textSelect.value]);
    });
}

function updateEndpointDisplay(textareaId, url) {
    const el = document.getElementById(textareaId);
    if (el && url) el.value = url;
}

function setupConfigSave() {
    document.getElementById('btn-save-config').addEventListener('click', async () => {
        const visionKey = getVal('cfg-vision-model');
        const textKey   = getVal('cfg-text-model');

        const visionInfo = MODEL_OPTIONS[visionKey];
        const textInfo   = MODEL_OPTIONS[textKey];

        const newCfg = {
            apiKey:              getVal('cfg-apikey'),
            visionModel:         visionInfo?.model || '',
            visionEndpoint:      _endpoints[visionKey] || '',
            textModel:           textInfo?.model || '',
            textEndpoint:        _endpoints[textKey] || '',
            defaultReceiver:     getVal('cfg-receiver'),
            defaultReceiverCode: getVal('cfg-receiver-code'),
            referralPersonName:  getVal('cfg-ref-name'),
            referralPersonRole:  getVal('cfg-ref-role')
        };

        try {
            const res = await chrome.runtime.sendMessage({ action: 'saveConfig', payload: newCfg });
            showMsg('config-msg', res.success ? '✅ تنظیمات ذخیره شد' : '❌ خطا: ' + res.error,
                    res.success ? 'msg-success' : 'msg-error');
        } catch (e) {
            showMsg('config-msg', '❌ خطا در ذخیره: ' + e.message, 'msg-error');
        }

        // ذخیره auto-confirm و auto-close
        const autoConfirm = document.getElementById('cfg-autoconfirm').checked;
        const autoClose = document.getElementById('cfg-autoclose').checked;
        const recycleReceipts = document.getElementById('cfg-recycle-receipts').checked;
        const autoEmptyInterval = parseInt(document.getElementById('cfg-autoempty-interval').value) || 5;
        await chrome.storage.local.set({ 
            autoimport_autoconfirm: autoConfirm,
            autoimport_autoclose: autoClose,
            autoimport_recycle_receipts: recycleReceipts,
            autoimport_autoempty_interval: autoEmptyInterval
        });
    });
}

// ===== تب دفترچه آدرس =====
async function loadAddressBookInfo() {
    try {
        const res = await chrome.runtime.sendMessage({ action: 'getAddressBook' });
        if (res.success) {
            document.getElementById('address-count').textContent =
                `${res.data.length} سازمان در دفترچه آدرس`;
        }
    } catch (e) { log.error('loadAddressBookInfo', e); }
}

function setupAddressBookEvents() {
    // آپلود فایل
    const uploadArea = document.getElementById('upload-area');
    const fileInput  = document.getElementById('file-input');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', e => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', e => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) processAddressBookFile(file);
    });
    fileInput.addEventListener('change', e => {
        if (e.target.files[0]) processAddressBookFile(e.target.files[0]);
    });

    // جستجو
    document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 300));

    // بارگذاری مجدد
    document.getElementById('btn-reload-book').addEventListener('click', async () => {
        const res = await chrome.runtime.sendMessage({ action: 'reloadAddressBook' });
        if (res.success) {
            document.getElementById('address-count').textContent = `${res.count} سازمان`;
            document.getElementById('info-addressbook').textContent = `${res.count} سازمان`;
        }
    });
}

// --- پردازش فایل اکسل/CSV آپلود شده ---
async function processAddressBookFile(file) {
    const uploadArea = document.getElementById('upload-area');
    uploadArea.querySelector('.upload-text').textContent = '⏳ در حال پردازش...';

    try {
        if (file.name.endsWith('.csv')) {
            // CSV
            const text = await file.text();
            const entries = parseCSV(text);
            await saveAndUpdateAddressBook(entries, file.name);
        } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            // XLSX — از FileReader برای base64 استفاده می‌کنیم
            // چون extension نمی‌تواند openpyxl اجرا کند، فایل را به background می‌فرستیم
            const arrayBuffer = await file.arrayBuffer();
            const entries = await parseXLSX(arrayBuffer);
            if (entries && entries.length > 0) {
                await saveAndUpdateAddressBook(entries, file.name);
            } else {
                throw new Error('داده‌ای از فایل اکسل استخراج نشد. فرمت CSV پیشنهاد می‌شود.');
            }
        }
    } catch (e) {
        log.error('processAddressBookFile', e);
        uploadArea.querySelector('.upload-text').textContent = '❌ خطا: ' + e.message;
        uploadArea.querySelector('.upload-sub').textContent = 'فایل CSV با دو ستون (نام سازمان، ایمیل) آپلود کنید';
    }
}

// --- پارس CSV ---
function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    return lines.map(line => {
        const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
        return { name: parts[0] || '', email: (parts[1] || '').toLowerCase() };
    }).filter(e => e.name && e.email);
}

// --- پارس XLSX (ساده، بدون کتابخانه) ---
async function parseXLSX(arrayBuffer) {
    // تلاش برای خواندن فایل ZIP/XLSX
    try {
        // از TextDecoder برای خواندن sharedStrings استفاده می‌کنیم
        const bytes = new Uint8Array(arrayBuffer);
        // بررسی signature ZIP: PK
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
            throw new Error('فرمت فایل معتبر نیست');
        }

        // ارسال به background برای پردازش سمت سرور نیست (extension محدودیت دارد)
        // fallback: از user می‌خواهیم CSV آپلود کند
        throw new Error('فرمت XLSX پشتیبانی نمی‌شود. لطفاً فایل را به CSV تبدیل کنید.');
    } catch (e) {
        throw e;
    }
}

async function saveAndUpdateAddressBook(entries, filename) {
    const res = await chrome.runtime.sendMessage({ action: 'saveAddressBook', payload: entries });
    const uploadArea = document.getElementById('upload-area');
    if (res.success) {
        uploadArea.querySelector('.upload-text').textContent = `✅ ${res.count} سازمان از ${filename} بارگذاری شد`;
        uploadArea.querySelector('.upload-sub').textContent = 'برای تغییر، فایل جدید آپلود کنید';
        document.getElementById('address-count').textContent = `${res.count} سازمان در دفترچه آدرس`;
        document.getElementById('info-addressbook').textContent = `${res.count} سازمان`;
    } else {
        uploadArea.querySelector('.upload-text').textContent = '❌ خطا در ذخیره: ' + res.error;
    }
}

// --- جستجو در دفترچه ---
async function handleSearch() {
    const query = document.getElementById('search-input').value.trim();
    const resultsEl = document.getElementById('search-results');

    if (query.length < 2) {
        resultsEl.innerHTML = '';
        resultsEl.classList.remove('has-results');
        return;
    }

    try {
        const res = await chrome.runtime.sendMessage({ action: 'getAddressBook' });
        if (!res.success) return;

        const q = query.toLowerCase();
        const matches = res.data.filter(e =>
            (e.name && e.name.toLowerCase().includes(q)) ||
            (e.email && e.email.toLowerCase().includes(q))
        ).slice(0, 15);

        if (matches.length === 0) {
            resultsEl.innerHTML = '<div class="search-result-item" style="color:#64748b;font-size:11px;">نتیجه‌ای یافت نشد</div>';
        } else {
            resultsEl.innerHTML = matches.map(e => `
                <div class="search-result-item">
                    <div class="search-result-name">${highlight(e.name, query)}</div>
                    <div class="search-result-email">${e.email}</div>
                </div>
            `).join('');
        }
        resultsEl.classList.add('has-results');
    } catch (e) {
        log.error('handleSearch', e);
    }
}

// --- هایلایت کلمه جستجو ---
function highlight(text, query) {
    if (!text || !query) return text || '';
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<mark style="background:#4f46e5;color:#fff;border-radius:2px;padding:0 2px;">$1</mark>');
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ===== Helpers =====
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function showMsg(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `msg-box ${cls}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

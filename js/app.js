// --- CONFIGURATION ---
const GITHUB_USERNAME = "sesese1234"; 
const GITHUB_REPO_NAME = "SecureGuardMDM"; 
const TARGET_PACKAGE = "com.secureguard.mdm";
const DEVICE_ADMIN = ".SecureGuardDeviceAdminReceiver";

// --- GLOBAL STATE ---
let adb;
let webusb;
let apkBlob = null;
let foundRelease = null; 

const appState = {
    adbConnected: false,
    accountsClean: false,
    apkDownloaded: false
};

// --- DEV MODE & MOCK INFRASTRUCTURE ---
window.DEV_MODE = false;
let mockResolver = null; // Function to resolve the pending command

// UI Builder for Dev Console
function initDevConsole() {
    if(document.getElementById('dev-console')) return;

    const html = `
    <div id="dev-console">
        <div class="dev-header">
            <span>[MOCK DEVICE TERMINAL]</span>
            <span style="font-size:10px; cursor:pointer;" onclick="document.getElementById('dev-console').style.display='none'">X</span>
        </div>
        <div id="dev-log" class="dev-log"></div>
        <div class="dev-controls">
            <div class="dev-input-group">
                <input type="text" id="dev-manual-input" placeholder="Type manual response here...">
                <button class="dev-btn" onclick="devSendManual()">SEND</button>
            </div>
            <div style="font-size:10px; color:#666; margin-bottom:4px;">PRESETS:</div>
            <div class="dev-scenarios">
                <button class="dev-btn" onclick="devPreset('success')">CMD Success</button>
                <button class="dev-btn" onclick="devPreset('model')">Model Info</button>
                <button class="dev-btn" onclick="devPreset('no_acc')">No Accounts</button>
                <button class="dev-btn" onclick="devPreset('has_acc')">Has Accounts</button>
                <button class="dev-btn" onclick="devPreset('install_ok')">Install OK</button>
                <button class="dev-btn" onclick="devPreset('dpm_ok')">Owner OK</button>
                <button class="dev-btn" onclick="devPreset('error')">Generic Error</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    devLog("System initialized. Waiting for connection...");
}

// Helpers for Dev Console
function devLog(msg, type = 'info') {
    const log = document.getElementById('dev-log');
    if(!log) return;
    const div = document.createElement('div');
    div.className = `dev-log-entry ${type}`;
    div.innerText = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

window.devSendManual = function() {
    const input = document.getElementById('dev-manual-input');
    if(mockResolver) {
        devLog(`Manual Response: ${input.value}`, 'resp');
        mockResolver(input.value);
        mockResolver = null;
        input.value = '';
    } else {
        devLog("No pending command to respond to.", 'error');
    }
}

window.devPreset = function(type) {
    if(!mockResolver) return;
    let resp = "";
    switch(type) {
        case 'success': resp = "Success"; break;
        case 'model': resp = "ro.product.model: Pixel 8 Pro (Mock)"; break;
        case 'no_acc': resp = ""; break; // Empty output for accounts = clean
        case 'has_acc': resp = "Account {name=test@gmail.com, type=com.google}"; break;
        case 'install_ok': resp = "Success"; break;
        case 'dpm_ok': resp = "Success: Device owner set to package " + TARGET_PACKAGE; break;
        case 'error': resp = "Error: Something went wrong"; break;
    }
    devLog(`Preset [${type}]: ${resp}`, 'resp');
    mockResolver(resp);
    mockResolver = null;
}

// MOCK ADB IMPLEMENTATION
class MockADB {
    async connectAdb(path) {
        devLog(`connecting to ${path}...`);
        return this; // Return self as the 'adb' instance
    }

    async shell(cmd) {
        devLog(`$ ${cmd}`, 'cmd');
        devLog(`Waiting for response...`, 'waiting');
        
        // Return a Promise that the UI will resolve
        const responseText = await new Promise(resolve => {
            mockResolver = resolve;
        });

        // Convert string response to WebADB compatible stream
        const encoder = new TextEncoder();
        const view = encoder.encode(responseText + "\n");
        
        return {
            read: async function() {
                if (this.called) return { done: true, value: undefined };
                this.called = true;
                return { done: false, value: view };
            },
            called: false
        };
    }

    async sync() {
        devLog(`> Requesting SYNC service`, 'cmd');
        return {
            push: async (file, path, mode, onProgress) => {
                devLog(`> PUSH ${file.name} to ${path}`, 'cmd');
                // Simulate progress
                for(let i=0; i<=100; i+=20) {
                    await sleep(200);
                    onProgress(i, 100);
                    devLog(`Upload: ${i}%`, 'info');
                }
                devLog(`> PUSH Complete`, 'resp');
                return true;
            },
            quit: async () => devLog(`> SYNC Closed`, 'info')
        };
    }
}

window.enableDevMode = function() {
    window.DEV_MODE = true;
    initDevConsole();
    
    // Auto-enable update mock
    foundRelease = { url: "http://mock-url/file.apk" }; 
    const updateInfo = document.getElementById('update-info-text');
    if(updateInfo) updateInfo.innerHTML = `גרסה חדשה זמינה: <b>v1.0.0-MOCK</b>`;
    
    showToast("Developer Mode & Mock Device Enabled");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- REAL LOGIC (Now cleaner because it relies on the injected object) ---

// --- IMPROVED ERROR MAPPING ---
const ADB_ERRORS = {
    "INSTALL_FAILED_ALREADY_EXISTS": "האפליקציה כבר מותקנת. מנסה לעדכן...",
    "INSTALL_FAILED_INSUFFICIENT_STORAGE": "אין מספיק מקום פנוי במכשיר.",
    "INSTALL_FAILED_UPDATE_INCOMPATIBLE": "קיימת גרסה קודמת עם חתימה שונה. יש למחוק אותה ידנית.",
    "Permission denied": "אין הרשאה לביצוע הפעולה. וודא שאישרת 'ניפוי באגים' במכשיר.",
    "device unauthorized": "המכשיר לא מאושר. בדוק את מסך המכשיר ואשר את החיבור.",
    "not found": "המכשיר התנתק. בדוק את תקינות הכבל.",
    "there are already some accounts": "שגיאה: נמצאו חשבונות פעילים. חזור לשלב 2.",
    "already a device owner": "שגיאה: כבר קיים מנהל מכשיר (Device Owner). יש לבצע איפוס יצרן.",
};


async function connectAdb() {
    try {
        if (window.DEV_MODE) {
            // In Dev Mode, we swap the real ADB library for our Mock Class
            webusb = new MockADB(); 
            adb = await webusb.connectAdb("mock::device");
        } else {
            webusb = await Adb.open("WebUSB");
            adb = await webusb.connectAdb("host::");
        }

        if(adb) {
            // Note: In dev mode, this shell command will pause waiting for the 'model' preset
            let shell = await adb.shell("getprop ro.product.model");
            let model = await readAll(shell);
            
            // Cleanup model string (remove prefix if present from getprop)
            model = model.replace('ro.product.model:', '').trim();
            if(!model) model = "Generic Android";

            updateStatusBadge('adb-status', `<span class="material-symbols-rounded">link</span> מחובר: ${model}`, 'success');
            
            document.getElementById('btn-connect').style.display = 'none';
            const nextBtn = document.getElementById('btn-next-adb');
            nextBtn.style.display = 'inline-flex';
            nextBtn.disabled = false;
            appState.adbConnected = true;
            
            showToast("המכשיר חובר בהצלחה");
        }
    } catch (e) {
        showToast("שגיאה בחיבור: " + e.message);
        console.error(e);
    }
}

/**
 * Helper to map account types to Icons, Colors, and Readable Names
 */
function getAccountVisuals(type) {
    // Normalize type string
    const t = type.toLowerCase();

    if (t.includes('google')) {
        return { label: 'Google Account', icon: 'cloud', class: 'acc-google' };
    }
    if (t.includes('samsung') || t.includes('osp')) {
        return { label: 'Samsung Account', icon: 'smartphone', class: 'acc-samsung' };
    }
    if (t.includes('whatsapp')) {
        return { label: 'WhatsApp', icon: 'chat', class: 'acc-whatsapp' };
    }
    if (t.includes('exchange') || t.includes('outlook') || t.includes('office')) {
        return { label: 'Exchange/Outlook', icon: 'mail', class: 'acc-exchange' };
    }
    if (t.includes('telegram')) {
        return { label: 'Telegram', icon: 'send', class: 'acc-telegram' };
    }
    if (t.includes('facebook') || t.includes('meta')) {
        return { label: 'Facebook', icon: 'thumb_up', class: 'acc-google' }; // Reusing generic class
    }
    
    // Default fallback
    return { label: type, icon: 'account_circle', class: '' };
}

async function checkAccounts() {
    const accountListDiv = document.getElementById('account-list');
    accountListDiv.innerHTML = ''; 

    if(!adb) { showToast("ADB לא מחובר"); return; }
    
    updateStatusBadge('account-status', `<span class="material-symbols-rounded">hourglass_top</span> בודק...`, '');
    
    try {
        // Attempt 1: 'cmd account list' (Cleaner output on newer Androids)
        let s = await adb.shell("cmd account list");
        let output = await readAll(s);
        
        // Attempt 2: 'dumpsys account' (Fallback for older devices or restricted permissions)
        if (!output || output.trim().length === 0 || (!output.includes('Account {') && !window.DEV_MODE)) {
            console.log("Falling back to dumpsys...");
            s = await adb.shell("dumpsys account");
            output = await readAll(s);
        }

        console.log("Raw Accounts output:", output); 

        // Improved Regex to capture {name=..., type=...} accurately
        // Handles spaces after commas and varies formats
        const accountRegex = /Account\s*\{name=([^,]+),\s*type=([^}]+)\}/gi;
        let matches = [...output.matchAll(accountRegex)];
        
        // Filter out "duplicate" entries if dumpsys returns multiple sections
        // We create a Set based on unique "name+type" to avoid showing the same account twice
        const uniqueAccounts = [];
        const seen = new Set();

        matches.forEach(m => {
            const name = m[1].trim();
            const type = m[2].trim();
            const key = `${name}|${type}`;
            if(!seen.has(key)) {
                seen.add(key);
                uniqueAccounts.push({ name, type });
            }
        });

        if (uniqueAccounts.length === 0) {
            updateStatusBadge('account-status', `<span class="material-symbols-rounded">check_circle</span> מכשיר נקי`, 'success');
            document.getElementById('btn-next-acc').disabled = false;
            appState.accountsClean = true;
            
            // Show nice "Clean" state in list area
            accountListDiv.innerHTML = `
                <div style="text-align:center; padding: 20px; color: #81C784;">
                    <span class="material-symbols-rounded" style="font-size: 48px;">check_circle_outline</span>
                    <p>לא נמצאו חשבונות. ניתן להמשיך.</p>
                </div>`;
            
            showToast("המכשיר מוכן להתקנה");
        } else {
            updateStatusBadge('account-status', `<span class="material-symbols-rounded">error</span> נמצאו ${uniqueAccounts.length} חשבונות`, 'error');
            
            let cardsHtml = '';
            
            uniqueAccounts.forEach(acc => {
                const visuals = getAccountVisuals(acc.type);
                
                cardsHtml += `
                <div class="account-card ${visuals.class}">
                    <div class="account-icon-wrapper">
                        <span class="material-symbols-rounded">${visuals.icon}</span>
                    </div>
                    <div class="account-info">
                        <div class="account-name" title="${acc.name}">${acc.name}</div>
                        <div class="account-type">
                            ${visuals.label}
                            <span style="font-size:0.7em; opacity:0.6;">(${acc.type})</span>
                        </div>
                    </div>
                </div>`;
            });

            accountListDiv.innerHTML = cardsHtml;
            document.getElementById('btn-next-acc').disabled = true;
            appState.accountsClean = false;
        }
    } catch (e) {
        showToast("שגיאה בבדיקת חשבונות");
        console.error("Account check error:", e);
        // Fallback UI for error
        updateStatusBadge('account-status', `שגיאה בבדיקה`, 'error');
    }
}

async function checkForUpdates() {
    const infoText = document.getElementById('update-info-text');
    const btn = document.getElementById('btn-download');
    
    // We keep this check simple as it talks to GitHub, not ADB
    if (window.DEV_MODE) {
        infoText.innerHTML = `גרסה חדשה זמינה: <b>v1.0.0-MOCK</b>`;
        btn.disabled = false;
        foundRelease = { url: "http://mock" };
        return;
    }

    try {
        const apiUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO_NAME}/releases/latest`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("Could not fetch releases from GitHub");
        
        const data = await response.json();
        const asset = data.assets.find(a => a.name.endsWith('.apk'));
        
        if (!asset) throw new Error("No APK asset found in the latest release");

        foundRelease = asset;
        infoText.innerHTML = `גרסה חדשה זמינה: <b>${data.tag_name}</b>`;
        btn.disabled = false;

    } catch (error) {
        infoText.innerText = "לא נמצאו עדכונים (משתמש בגרסה מובנית).";
        console.error(error);
    }
}

async function startDownload() {
    if (!foundRelease) return;

    const btn = document.getElementById('btn-download');
    const bar = document.getElementById('dl-progress-bar');
    const wrapper = document.getElementById('dl-progress-wrapper');
    const text = document.getElementById('dl-status-text');

    btn.disabled = true;
    wrapper.style.display = 'block';
    text.innerText = "מוריד...";

    if (window.DEV_MODE) {
        for(let i=0; i<=100; i+=10) {
            bar.style.width = i + "%";
            text.innerText = i + "%";
            await sleep(100);
        }
        apkBlob = new Blob(["mock-data"]); 
        text.innerText = "הורדה הושלמה! (MOCK)";
        appState.apkDownloaded = true;
        setTimeout(() => navigateTo('page-install', 4), 1000);
        return;
    }

    try {
        const response = await fetch(foundRelease.url, {
            headers: { 'Accept': 'application/octet-stream' }
        });
        if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');
        let receivedLength = 0;
        let chunks = [];

        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            
            if(contentLength) {
                let pct = Math.round((receivedLength / contentLength) * 100);
                bar.style.width = pct + "%";
                text.innerText = pct + "%";
            }
        }

        apkBlob = new Blob(chunks);
        text.innerText = "הורדה הושלמה!";
        appState.apkDownloaded = true;
        setTimeout(() => navigateTo('page-install', 4), 1000);

    } catch (e) {
        text.innerText = "שגיאה בהורדה";
        showToast(e.message);
        btn.disabled = false;
        console.error(e);
    }
}


/**
 * Helper to execute shell commands with validation and Hebrew feedback
 */
async function executeAdbCommand(command, description) {
    log(`> ${description}...`, 'info');
    try {
        const shell = await adb.shell(command);
        const response = await readAll(shell);
        
        // Android shell often returns error strings even if the command "executes"
        const lowerRes = response.toLowerCase();
        
        // Search for known errors in the response
        for (const [key, hebrewMsg] of Object.entries(ADB_ERRORS)) {
            if (response.includes(key)) {
                throw new Error(hebrewMsg + ` (${key})`);
            }
        }

        // Generic failure check (common in pm install)
        if (lowerRes.includes("failure") || lowerRes.includes("error")) {
             throw new Error("נכשלה הפעולה: " + response);
        }

        log(` הצלחה: ${description}`, 'success');
        return response;
    } catch (e) {
        log(` שגיאה ב${description}: ${e.message}`, 'error');
        throw e; // Rethrow to stop the installation sequence
    }
}

async function runInstallation() {
    const btn = document.getElementById('btn-install-start');
    const logEl = document.getElementById('install-log');
    logEl.innerHTML = ""; // Clear log
    
    if(!adb) { 
        showToast("ADB לא מחובר"); 
        return; 
    }

    btn.disabled = true;
    updateProgress(0);
    
    try {
        // 1. Validate APK
        if(!apkBlob) {
            log("> טוען קובץ התקנה...", 'info');
            const resp = await fetch('apk/update.apk');
            if(!resp.ok) throw new Error("קובץ ה-APK חסר בשרת.");
            apkBlob = await resp.blob();
        }

        // 2. Push File
        log("> מעביר קובץ למכשיר...", 'info');
        const sync = await adb.sync();
        const file = new File([apkBlob], "app.apk");
        
        await sync.push(file, "/data/local/tmp/app.apk", 0o644, (sent, total) => {
            updateProgress(0.1 + (sent / total * 0.3));
        });
        await sync.quit();
        log(" הקובץ הועבר בהצלחה.", 'success');

        // 3. Install
        updateProgress(0.5);
        await executeAdbCommand(
            `pm install -r "/data/local/tmp/app.apk"`, 
            "התקנת אפליקציה"
        );

        // 4. Set Device Owner
        updateProgress(0.7);
        await executeAdbCommand(
            `dpm set-device-owner ${TARGET_PACKAGE}/${DEVICE_ADMIN}`, 
            "הגדרת מנהל מערכת"
        );

        // 5. Launch
        updateProgress(0.9);
        await executeAdbCommand(
            `am start -n ${TARGET_PACKAGE}/.MainActivity`, 
            "פתיחת אפליקציה"
        );

        updateProgress(1.0);
        log("\n הכלי הותקן והוגדר בהצלחה!", 'success');
        showToast("הסתיים בהצלחה!");

    } catch (e) {
        console.error(e);
        log(`\n התקנה נעצרה: ${e.message}`, 'error');
        showToast("ההתקנה נכשלה");
        btn.disabled = false;
    }
}

async function readAll(stream) {
    const decoder = new TextDecoder();
    let res = "";
    try {
        while (true) {
            // ב-WebADB משתמשים ב-receive() כדי לקבל הודעה מהמכשיר
            let msg = await stream.receive();

            if (msg.cmd === "WRTE") {
                // הודעת WRTE מכילה נתונים
                res += decoder.decode(msg.data);
                // חובה לשלוח OKAY חזרה כדי שהמכשיר ימשיך לשלוח את שאר הנתונים
                await stream.send("OKAY");
            } else if (msg.cmd === "CLSE") {
                // הודעת CLSE אומרת שהמכשיר סיים להעביר נתונים
                break;
            }
        }
    } catch (e) {
        console.warn("Stream reading interrupted", e);
    }
    return res.trim();
}
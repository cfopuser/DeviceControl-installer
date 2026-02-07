import { appState } from './state.js';
import { CONFIG } from './config.js';
import { executeAdbCommand, wait } from './adb-client.js';
import { log, showToast, updateProgress, navigateTo } from './ui.js';
import { restoreAccounts } from './accounts.js';

let apkBlob = null;
let foundRelease = null;

export async function checkForUpdates() {
    const infoText = document.getElementById('update-info-text');
    const btn = document.getElementById('btn-download');

    try {
        const resp = await fetch(`https://api.github.com/repos/${CONFIG.GITHUB_USERNAME}/${CONFIG.GITHUB_REPO_NAME}/releases/latest`);
        if (!resp.ok) throw new Error("GitHub Error");
        const data = await resp.json();
        const asset = data.assets.find(a => a.name.endsWith('.apk'));
        
        if (asset) {
            foundRelease = asset;
            infoText.innerHTML = `גרסה חדשה: <b>${data.tag_name}</b>`;
            btn.disabled = false;
        } else { throw new Error("No APK"); }
    } catch (e) {
        infoText.innerText = "משתמש בגרסה מובנית.";
        console.error(e);
    }
}

export async function startDownload() {
    if (!foundRelease) return;
    const btn = document.getElementById('btn-download');
    const bar = document.getElementById('dl-progress-bar');
    
    btn.disabled = true;
    document.getElementById('dl-progress-wrapper').style.display = 'block';

    try {
        const resp = await fetch(foundRelease.url, { headers: { 'Accept': 'application/octet-stream' } });
        const reader = resp.body.getReader();
        const len = +resp.headers.get('Content-Length');
        let received = 0, chunks = [];

        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (len) bar.style.width = Math.round((received/len)*100) + "%";
        }
        
        apkBlob = new Blob(chunks);
        appState.apkDownloaded = true;
        setTimeout(() => navigateTo('page-install', 4), 1000);
    } catch (e) {
        showToast("שגיאה בהורדה");
        btn.disabled = false;
    }
}

export async function runInstallation() {
    if (!appState.adbConnected) return showToast("ADB Disconnected");
    const btn = document.getElementById('btn-install-start');
    btn.disabled = true;
    updateProgress(0);

    // Hide Video & Show Success placeholder
    document.getElementById('guide-video').style.display = 'none';
    document.querySelector('.phone-controls').style.display = 'none';
    document.getElementById('phone-success-message').style.display = 'flex';

    try {
        // Pre-checks
        const owner = await executeAdbCommand("dpm get-device-owner", "Check Owner", true);
        if (owner.includes("ComponentInfo") && !owner.includes(CONFIG.TARGET_PACKAGE)) throw new Error("קיים ניהול אחר");
        
        // Load APK
        if (!apkBlob) {
            log("טוען APK מקומי...", 'info');
            const resp = await fetch(CONFIG.APK_LOCAL_PATH);
            if (!resp.ok) throw new Error("APK מקומי חסר");
            apkBlob = await resp.blob();
        }

        // Push
        log("מעביר קובץ...", 'info');
        const sync = await appState.adbInstance.sync();
        const file = new File([apkBlob], "app.apk");
        await sync.push(file, "/data/local/tmp/app.apk", 0o644, (s, t) => updateProgress(0.1 + (s/t)*0.3));
        await sync.quit();
        
        await wait(1000);

        // Install
        updateProgress(0.5);
        await executeAdbCommand(`pm install -r -g "/data/local/tmp/app.apk"`, "Install APK");
        
        await wait(2000);

        // Set Owner
        updateProgress(0.8);
        await executeAdbCommand(`dpm set-device-owner ${CONFIG.TARGET_PACKAGE}/${CONFIG.DEVICE_ADMIN}`, "Set Owner");
        
        // Launch
        updateProgress(1.0);
        await executeAdbCommand(`am start -n ${CONFIG.TARGET_PACKAGE}/.MainActivity`, "Launch");

        showToast("הסתיים בהצלחה!");
    } catch (e) {
        log(`Error: ${e.message}`, 'error');
        showToast("התקנה נכשלה");
    } finally {
        if (appState.disabledPackages.length > 0) await restoreAccounts();
        btn.disabled = false;
    }
}
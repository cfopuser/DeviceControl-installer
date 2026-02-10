import { appState, saveSessionState } from './state.js';
import { executeAdbCommand, wait } from './adb-client.js';
import { log, showToast, updateStatusBadge, navigateTo } from './ui.js';
import { PROTECTED_PACKAGES, KNOWN_OFFENDERS, ACCOUNT_PKG_MAP } from './config.js';

// --- Visual Helpers (ICONS) ---
const ICONS = {
    google: '<svg viewBox="0 0 24 24"><path d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.9 8.2,4.73 12.2,4.73C15.29,4.73 17.1,6.7 17.1,6.7L19,4.72C19,4.72 16.56,2 12.1,2C6.42,2 2.03,6.8 2.03,12C2.03,17.05 6.16,22 12.25,22C17.6,22 21.5,18.33 21.5,12.91C21.5,11.76 21.35,11.1 21.35,11.1V11.1Z" /></svg>',
    samsung: '<svg viewBox="0 0 24 24"><path d="M16.94 13.91C16.82 13.91 16.58 13.91 16.34 13.88C15.93 13.82 15.65 13.72 15.35 13.56L15.42 12.94C15.69 13.09 16.03 13.21 16.39 13.27C16.58 13.3 16.73 13.3 16.8 13.3C17.5 13.3 17.81 12.99 17.81 12.55C17.81 12.08 17.51 11.85 16.64 11.66L16.23 11.58C14.79 11.27 13.92 10.74 13.92 9.7C13.92 8.44 14.94 7.55 16.68 7.55C17.38 7.55 18.06 7.66 18.66 7.89L18.45 8.5C17.96 8.32 17.39 8.21 16.77 8.21C16.14 8.21 15.82 8.5 15.82 8.9C15.82 9.32 16.15 9.54 16.98 9.72L17.38 9.8C18.94 10.14 19.72 10.72 19.72 11.73C19.72 13.11 18.63 13.91 16.94 13.91M11.6 13.84H9.72V7.63H13.68V8.24H11.6V10.35H13.39V10.96H11.6V13.84M22 10.73C22 14.63 17.53 17.8 12 17.8C6.47 17.8 2 14.63 2 10.73C2 6.83 6.47 3.66 12 3.66C17.53 3.66 22 6.83 22 10.73Z" /></svg>',
    generic: '<span class="material-symbols-rounded">cloud</span>'
};

function getAccountVisuals(type) {
    const t = type.toLowerCase();
    if (t.includes('google')) return { label: 'Google', html: ICONS.google, class: 'acc-google' };
    if (t.includes('samsung') || t.includes('osp')) return { label: 'Samsung', html: ICONS.samsung, class: 'acc-samsung' };
    return { label: type, html: ICONS.generic, class: 'acc-unknown' };
}

// --- Logic ---

async function getAllAccountData() {
    let output = "";
    try {
        output += await executeAdbCommand("cmd account list --user 0", "Scan User 0", true) + "\n";
        output += await executeAdbCommand("cmd account list", "Scan General", true) + "\n";
        output += await executeAdbCommand("dumpsys account", "Deep Dump", true) + "\n";
    } catch (e) { console.warn(e); }
    return output;
}

export async function checkAccounts() {
    if (!appState.adbConnected) return showToast("ADB לא מחובר");
    
    const listDiv = document.getElementById('account-list');
    const bypassBtn = document.getElementById('btn-bypass-trigger');
    
    updateStatusBadge('account-status', 'בודק...', '');
    bypassBtn.style.display = 'none';
    listDiv.innerHTML = '';

    try {
        const output = await getAllAccountData();
        const accountRegex = /(?:name=([^\s,]+)[^}]*type=([^\s}]+))/gi;
        const matches = [...output.matchAll(accountRegex)];
        
        const unique = new Map();
        matches.forEach(m => unique.set(`${m[1]}|${m[2]}`, {name: m[1], type: m[2]}));

        if (unique.size === 0) {
            updateStatusBadge('account-status', 'מכשיר נקי', 'success');
            document.getElementById('btn-next-acc').disabled = false;
            appState.accountsClean = true;
            listDiv.innerHTML = `<div style="text-align:center; padding:20px; color:#81C784;"><span class="material-symbols-rounded">check_circle</span><p>נקי מחשבונות</p></div>`;
        } else {
            updateStatusBadge('account-status', `נמצאו ${unique.size} חשבונות`, 'error');
            
            // Show bypass button (Note: Logic to block SDK 34+ is in the click handler in main.js)
            bypassBtn.style.display = 'inline-flex';
            
            appState.accountsClean = false;
            document.getElementById('btn-next-acc').disabled = true;

            let html = '';
            unique.forEach(acc => {
                const vis = getAccountVisuals(acc.type);
                html += `<div class="account-card ${vis.class}"><div class="account-icon-wrapper">${vis.html}</div><div class="account-info"><div class="account-name">${acc.name}</div><div class="account-type">${vis.label}</div></div></div>`;
            });
            listDiv.innerHTML = html;
        }
    } catch (e) {
        showToast("שגיאה בבדיקה");
        console.error(e);
    }
}

export async function runAccountBypass() {
    if (!appState.adbConnected) return;

    // Double check for Android 14+ just in case the UI check was bypassed
    if (appState.sdkVersion >= 34) {
        showToast("פעולה זו חסומה באנדרואיד 14+");
        document.getElementById('bypass-warning').style.display = 'none';
        return;
    }

    document.getElementById('bypass-warning').style.display = 'none';
    updateStatusBadge('account-status', 'מבצע השבתה...', '');

    try {
        const output = await getAllAccountData();
        let packagesToDisable = new Set();
        
        // Regex for packages/types
        const fuzzy = /(?:type=([^\s}]+))|([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
        const matches = [...output.matchAll(fuzzy)];

        for (const m of matches) {
            if (m[1]) { // Type match
                const pkg = ACCOUNT_PKG_MAP[m[1]] || (m[1].includes('.') ? m[1] : null);
                if (pkg) packagesToDisable.add(pkg);
            }
        }

        // Add Known Offenders
        for (const off of KNOWN_OFFENDERS) {
            const check = await executeAdbCommand(`pm list packages ${off}`, `Checking ${off}`, true);
            if (check.includes(off)) packagesToDisable.add(off);
        }

        let count = 0;
        for (const pkg of packagesToDisable) {
            if (PROTECTED_PACKAGES.some(p => pkg.startsWith(p))) continue;
            if (appState.disabledPackages.includes(pkg)) continue;

            try {
                await executeAdbCommand(`pm disable-user --user 0 ${pkg}`, `השבתת ${pkg}`);
                appState.disabledPackages.push(pkg);
                count++;
            } catch (e) { log(`Failed to disable ${pkg}`, 'error'); }
        }

        saveSessionState();
        
        if (count > 0) {
            await wait(2000);
            appState.accountsClean = true;
            showToast(`הושבתו ${count} רכיבים`);
            navigateTo('page-update', 3);
        } else {
            checkAccounts();
        }

    } catch (e) { showToast("שגיאה ב Bypass: " + e.message); }
}

export async function restoreAccounts() {
    if (appState.disabledPackages.length === 0) return;
    log("משחזר חשבונות...", 'info');
    for (const pkg of appState.disabledPackages) {
        try { await executeAdbCommand(`pm enable ${pkg}`, `Restore ${pkg}`); }
        catch (e) {}
    }
    appState.disabledPackages = [];
    localStorage.removeItem('mdm_disabled_packages');
    log("שוחזר בהצלחה", 'success');
}
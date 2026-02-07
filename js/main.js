// js/main.js
import { navigateTo, toggleVideo, log, showToast } from './ui.js';
import { connectAdb } from './adb-client.js';
import { checkAccounts, runAccountBypass } from './accounts.js';
import { checkForUpdates, startDownload, runInstallation } from './installer.js';
import { restoreSessionState } from './state.js';

// 1. ATTACH TO WINDOW IMMEDIATELY
window.navigateTo = navigateTo;
window.toggleVideo = toggleVideo;
window.connectAdb = connectAdb;
window.checkAccounts = checkAccounts;
window.runAccountBypass = runAccountBypass;
window.startDownload = startDownload;
window.runInstallation = runInstallation;
window.toggleBypassWarning = () => {
    const el = document.getElementById('bypass-warning');
    el.style.display = (el.style.display === 'block') ? 'none' : 'block';
};

// 2. INITIALIZE
document.addEventListener('DOMContentLoaded', () => {
    // Check Browser
    if (!('usb' in navigator)) {
        document.getElementById('page-main-content').style.display = 'none';
        document.getElementById('compatibility-notice').style.display = 'block';
    }

    // Restore previous session if crashed
    const restoredCount = restoreSessionState();
    if (restoredCount > 0) {
        log(`נמצאה הפעלה קודמת שנקטעה: ${restoredCount} חבילות מושבתות.`, 'warn');
    }
});
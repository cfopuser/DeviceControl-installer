// js/state.js
export const appState = {
    adbConnected: false,
    accountsClean: false,
    apkDownloaded: false,
    disabledPackages: [],
    adbInstance: null,
    webUsbInstance: null
};

export function saveSessionState() {
    localStorage.setItem('mdm_disabled_packages', JSON.stringify(appState.disabledPackages));
}

export function restoreSessionState() {
    const saved = localStorage.getItem('mdm_disabled_packages');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                appState.disabledPackages = parsed;
                return parsed.length; // Return count so UI can log it
            }
        } catch (e) {
            console.error("Failed to restore session", e);
        }
    }
    return 0;
}
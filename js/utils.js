/* --- UI HELPER FUNCTIONS --- */

function navigateTo(pageId, stepIndex) {
    // Pre-flight checks to prevent skipping steps
    if (stepIndex > 1 && !appState.adbConnected) {
        showToast("יש לחבר מכשיר תחילה (שלב 1)");
        return;
    }
    if (stepIndex > 2 && !appState.accountsClean) {
        showToast("יש לוודא שאין חשבונות במכשיר (שלב 2)");
        return;
    }

    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // Show target page
    document.getElementById(pageId).classList.add('active');
    
    // Update Stepper
    document.querySelectorAll('.step-dot').forEach((dot, index) => {
        dot.classList.remove('active');
        dot.classList.remove('completed'); // Reset completed status
        if (index === stepIndex) dot.classList.add('active');
        if (index < stepIndex) dot.classList.add('completed');
    });

    // --- VIDEO SWITCHING LOGIC ---
    const video = document.getElementById('guide-video');
    const icon = document.getElementById('video-icon');
    
    let targetVideo = null;

    if (stepIndex <= 1) { // Welcome and ADB
        targetVideo = "Videos/1.mp4";
    } else if (stepIndex === 2) { // Accounts
        targetVideo = "Videos/2.mp4";
    }

    // Only switch if the source is actually changing to prevent flickering
    if (targetVideo && !video.src.includes(targetVideo)) {
        video.src = targetVideo;
        video.play().catch(e => console.log("Auto-play prevented"));
        icon.innerText = 'pause'; // Reset icon to pause since we are auto-playing
    }
    
    // Logic triggers for when a page becomes active
    if (pageId === 'page-update' && typeof checkForUpdates === 'function') {
        checkForUpdates();
    }
    if (pageId === 'page-accounts' && typeof checkAccounts === 'function') {
        // Automatically trigger a check when navigating to this page if ADB is connected
        if (appState.adbConnected) checkAccounts();
    }
}

function showToast(message) {
    const x = document.getElementById("snackbar");
    x.innerText = message;
    x.className = "show";
    setTimeout(function(){ x.className = x.className.replace("show", ""); }, 3000);
}

function toggleVideo() {
    const vid = document.getElementById('guide-video');
    const icon = document.getElementById('video-icon');
    if (vid.paused) {
        vid.play();
        icon.innerText = 'pause';
    } else {
        vid.pause();
        icon.innerText = 'play_arrow';
    }
}

function updateStatusBadge(id, text, type) {
    const el = document.getElementById(id);
    el.innerHTML = text;
    el.className = 'status-badge ' + type;
}

function updateProgress(val) {
    const bar = document.getElementById('install-progress-bar');
    if(bar) bar.style.width = (val * 100) + "%";
}

function log(text, type = 'info') {
    const el = document.getElementById('install-log');
    if(el) {
        const div = document.createElement('div');
        div.className = `log-entry log-${type}`;
        
        // Handle multiline and sanitization
        const sanitized = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        div.innerHTML = sanitized.replace(/\n/g, '<br>');
        
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }
}

function checkBrowserCompatibility() {
    if ('usb' in navigator) {
        // WebUSB is supported
        return true;
    }
    
    // WebUSB is not supported
    document.getElementById('page-main-content').style.display = 'none';
    document.getElementById('compatibility-notice').style.display = 'block';
    return false;
}

// Run compatibility check on page load
document.addEventListener('DOMContentLoaded', checkBrowserCompatibility);
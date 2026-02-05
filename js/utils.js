/* --- UI HELPER FUNCTIONS --- */

function navigateTo(pageId, stepIndex) {

    if (pageId !== 'page-main') {
        document.body.classList.remove('welcome-mode');
    } else {
        document.body.classList.add('welcome-mode');
    }
    
    // If web updates are disabled, skip the 'update' page and jump to 'install'
    if (typeof ENABLE_WEB_UPDATE !== 'undefined' && !ENABLE_WEB_UPDATE && pageId === 'page-update') {
        pageId = 'page-install';
        stepIndex = 4;
    }

    // Pre-flight checks to prevent skipping steps
    if (stepIndex >= 2 && !appState.adbConnected) {
        showToast("יש לחבר מכשיר תחילה (שלב 1)");
        return;
    }
    // Check accounts if we are trying to go to Update or Install
    if (stepIndex >= 3 && !appState.accountsClean) {
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
        dot.classList.remove('completed'); 
        if (index === stepIndex) dot.classList.add('active');
        if (index < stepIndex) dot.classList.add('completed');
        
        if (typeof ENABLE_WEB_UPDATE !== 'undefined' && !ENABLE_WEB_UPDATE && index === 3) {
            dot.style.display = 'none';
        } else {
            dot.style.display = ''; 
        }
    });

    // --- AUTO ACTIONS ON PAGE LOAD ---
    if (pageId === 'page-accounts') {
        // Auto-check accounts when entering the page (Wait slight delay for transition)
        if (window.checkAccounts) {
            setTimeout(() => {
                checkAccounts();
            }, 300);
        }
    }

    if (pageId === 'page-install') {
        // Auto-run installation when the page is entered
        setTimeout(() => {
            if (typeof runInstallation === 'function') {
                runInstallation();
            }
        }, 600); 
    }

// --- IMPROVED VIDEO SWITCHING LOGIC ---
    const video = document.getElementById('guide-video');
    const icon = document.getElementById('video-icon');
    
    let targetVideo = null;

    if (stepIndex <= 1) { 
        targetVideo = "Videos/enable-adb.mp4";
    } else if (stepIndex === 2) { 
        targetVideo = "Videos/remove-accounts.mp4";
    }

    if (targetVideo && !video.src.includes(targetVideo)) {
        video.style.opacity = '0.4';
        
        setTimeout(() => {
            video.src = targetVideo;
            video.load(); 
            video.play().catch(e => console.log("Auto-play prevented"));
            video.style.opacity = '1';
            icon.innerText = 'pause';
        }, 200);
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
        
        const sanitized = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        div.innerHTML = sanitized.replace(/\n/g, '<br>');
        
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }
}

function checkBrowserCompatibility() {
    if ('usb' in navigator) {
        return true;
    }
    
    document.getElementById('page-main-content').style.display = 'none';
    document.getElementById('compatibility-notice').style.display = 'block';
    return false;
}

document.addEventListener('DOMContentLoaded', checkBrowserCompatibility);
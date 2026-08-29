// src/auth.js — Google sign-in, session restore, auth gate

const GOOGLE_CLIENT_ID = '996784289780-lrl7mub599dn6eti14h3nvfre2ov6027.apps.googleusercontent.com';

const CLOUD_FILE_NAME = 'luadeck_projects.json';
const CLOUD_SCOPE = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.appdata';
const TOKEN_STORAGE_KEY = 'luadeck_google_token';
const PROFILE_STORAGE_KEY = 'luadeck_google_profile';
const SCOPE_VERSION_KEY = 'luadeck_oauth_scope_v';
const SCOPE_VERSION = '2';

let googleClientId = GOOGLE_CLIENT_ID || localStorage.getItem('luadeck_google_client_id') || '';
let googleToken = null;
let googleTokenExpiresAt = 0;
let googleTokenClient = null;
let googleProfile = null;
let cloudFileId = null;
let cloudSaveTimer = null;
let cloudSyncing = false;

function setCloudStatus(msg, cls) {
    const el = document.getElementById('cloud-status');
    if (el) {
        el.textContent = msg;
        el.className = 'cloud-status' + (cls ? ' ' + cls : '');
    }
    const pill = document.getElementById('status-cloud-pill');
    if (pill) {
        pill.textContent = msg || 'Cloud: —';
        pill.className = 'status-cloud' + (cls ? ' ' + cls : '');
    }
}

function setAvatarEls(picture) {
    const pairs = [
        ['profile-avatar', 'profile-avatar-ph'],
        ['profile-avatar-side', 'profile-avatar-ph-side'],
    ];
    pairs.forEach(([avId, phId]) => {
        const av = document.getElementById(avId);
        const ph = document.getElementById(phId);
        if (!av) return;
        if (picture) {
            av.src = picture;
            av.style.display = 'block';
            if (ph) ph.style.display = 'none';
        } else {
            av.style.display = 'none';
            av.removeAttribute('src');
            if (ph) ph.style.display = 'flex';
        }
    });
}

function updateProfileUI() {
    const userEl = document.getElementById('account-menu-user');
    const signBtn = document.getElementById('account-signin-btn');
    const sideUser = document.getElementById('lx-side-user');
    const creditsEl = document.getElementById('account-credits-line');
    const subBtn = document.getElementById('account-sub-btn');

    const signedIn = !!(googleToken && isGoogleTokenValid());
    const picture = (signedIn && googleProfile && googleProfile.picture) ? googleProfile.picture : '';
    setAvatarEls(picture);

    let label = 'Not signed in';
    let side = 'Guest';
    if (signedIn && googleProfile) {
        label = (googleProfile.name || 'Account') + (googleProfile.email ? '\n' + googleProfile.email : '');
        side = googleProfile.name || googleProfile.email || 'Signed in';
    } else if (signedIn) {
        label = 'Signed in';
        side = 'Signed in';
    } else if (isAuthRestoring()) {
        label = 'Restoring session…';
        side = 'Restoring…';
    }
    if (userEl) { userEl.textContent = label; userEl.style.whiteSpace = 'pre-line'; }
    if (sideUser) sideUser.textContent = side;
    if (signBtn) {
        signBtn.textContent = signedIn ? 'Sign out' : 'Sign in with Google';
    }

    const st = loadCreditsState();
    if (creditsEl) {
        creditsEl.innerHTML = (isPro() ? 'Pro · ' : 'Free · ') +
            st.left + ' / ' + st.weekly + ' credits left this week' +
            '<br><span style="font-weight:500;color:var(--muted);font-size:0.75rem">Cloud ' +
            CREDIT_COSTS.cloud_save + '/hr · Export ' + CREDIT_COSTS.export +
            ' · resets weekly</span>';
    }
    const creditsPill = document.getElementById('status-credits-pill');
    if (creditsPill) {
        creditsPill.textContent = (isPro() ? 'Pro · ' : 'Free · ') + st.left + '/' + st.weekly + ' credits';
        creditsPill.title = 'Cloud backup ' + CREDIT_COSTS.cloud_save + '/hour · Export ' + CREDIT_COSTS.export + ' · weekly reset';
    }
    if (subBtn) subBtn.textContent = isPro() ? 'Billing & cancel' : 'LuaX Pro — €5/mo';
    renderBillingPanel();
}

function toggleAccountMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('account-menu');
    if (!menu) return;
    const open = menu.style.display === 'none' || !menu.style.display;
    menu.style.display = open ? 'flex' : 'none';
    updateProfileUI();
}

function closeAccountMenu() {
    const menu = document.getElementById('account-menu');
    if (menu) menu.style.display = 'none';
}

document.addEventListener('click', () => {
    closeAccountMenu();
    try { closeSpriteLayerMenus(); } catch (_) {}
});

let authRefreshing = false;
let authRefreshStartedAt = 0;
const AUTH_REFRESH_MAX_MS = 8000;
let authRefreshWatchdog = null;
let authGisWaitTimer = null;
let authRestoreAttempt = 0;

let loginPending = false;
let loginPendingStartedAt = 0;
let loginPendingTimer = null;
const LOGIN_PENDING_MAX_MS = 25000;

function clearLoginPending() {
    loginPending = false;
    loginPendingStartedAt = 0;
    if (loginPendingTimer) {
        clearTimeout(loginPendingTimer);
        loginPendingTimer = null;
    }
}

function armLoginPendingTimeout() {
    clearLoginPending();
    loginPending = true;
    loginPendingStartedAt = Date.now();
    loginPendingTimer = setTimeout(function onLoginTimeout() {
        if (!loginPending) return;
        if (Date.now() - loginPendingStartedAt < LOGIN_PENDING_MAX_MS - 500) {
            const left = LOGIN_PENDING_MAX_MS - (Date.now() - loginPendingStartedAt);
            loginPendingTimer = setTimeout(onLoginTimeout, Math.max(500, left));
            return;
        }
        clearLoginPending();
        showLoginError(
            'Sign-in timed out. On iPhone: Settings → Safari → turn off “Prevent Cross-Site Tracking”, allow pop-ups, then try again.'
        );
        setCloudStatus('Cloud: sign-in timed out', 'warn');
        applyAuthGate();
        updateProfileUI();
    }, LOGIN_PENDING_MAX_MS);
}

function checkLoginPendingOnVisible() {
    if (!loginPending) return;
    if (Date.now() - loginPendingStartedAt >= LOGIN_PENDING_MAX_MS) {
        clearLoginPending();
        showLoginError(
            'Sign-in timed out. Allow pop-ups for luax.pages.dev and try Sign in again.'
        );
        setCloudStatus('Cloud: sign-in timed out', 'warn');
        applyAuthGate();
        updateProfileUI();
    }
}

function checkRestoreOnVisible() {
    if (!authRefreshing) return;
    if (Date.now() - authRefreshStartedAt >= AUTH_REFRESH_MAX_MS) {
        if (!(googleToken && isGoogleTokenValid())) {
            failAuthRefresh('Cloud: session expired — sign in again');
        } else {
            authRefreshing = false;
            clearAuthRefreshTimers();
            hideRestoreOverlay();
        }
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        checkLoginPendingOnVisible();
        checkRestoreOnVisible();
    });
    window.addEventListener('pageshow', function () {
        checkLoginPendingOnVisible();
        checkRestoreOnVisible();
    });
    window.addEventListener('focus', function () {
        checkLoginPendingOnVisible();
        checkRestoreOnVisible();
    });
}

function hasRememberedProfile() {
    return !!(googleProfile && (googleProfile.email || googleProfile.name || googleProfile.picture));
}

function clearAuthRefreshTimers() {
    if (authRefreshWatchdog) {
        clearInterval(authRefreshWatchdog);
        clearTimeout(authRefreshWatchdog);
        authRefreshWatchdog = null;
    }
    if (authGisWaitTimer) {
        clearTimeout(authGisWaitTimer);
        authGisWaitTimer = null;
    }
}

function isAuthed() {
    if (googleToken && isGoogleTokenValid()) return true;
    return false;
}

function isAuthRestoring() {
    return !!(authRefreshing && hasRememberedProfile() &&
        (Date.now() - authRefreshStartedAt) < AUTH_REFRESH_MAX_MS);
}

function isGuestPlay() {
    return !!(window.luaxGuestPlay);
}
function setGuestPlay(on) {
    window.luaxGuestPlay = !!on;
}
function canAccessApp() {
    return isAuthed() || isGuestPlay();
}

function failAuthRefresh(reason) {
    authRefreshing = false;
    authRefreshStartedAt = 0;
    clearAuthRefreshTimers();
    hideRestoreOverlay();
    if (!(googleToken && isGoogleTokenValid())) {
        clearPersistedGoogleToken({ keepProfile: true });
        googleToken = null;
        googleTokenExpiresAt = 0;
    }
    setCloudStatus(reason || 'Cloud: sign in required', 'warn');
    applyAuthGate();
    updateProfileUI();
}

function applyAuthGate() {
    if (isGuestPlay()) {
        const login = document.getElementById('login-view');
        if (login) login.classList.remove('active');
        updateProfileUI();
        return;
    }
    const locked = !isAuthed();
    const login = document.getElementById('login-view');
    if (locked) {
        if (typeof isPlaying !== 'undefined' && isPlaying) {
            try { stopPlayMode(); } catch (_) {}
        }
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        if (login) login.classList.add('active');
        closeAccountMenu();
    } else {
        if (login) login.classList.remove('active');
        const any = document.querySelector('.view.active:not(#login-view)');
        if (!any) {
            document.getElementById('projects-view')?.classList.add('active');
        }
        void (typeof window.renderProjects === "function" && window.renderProjects());
        verifySubscriptionOnAccess().catch(() => {});
    }
    updateProfileUI();
}

function loginWithGoogle() {
    const errEl = document.getElementById('login-error');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    const client = ensureGoogleTokenClient(false);
    if (!client) {
        if (errEl) {
            errEl.textContent = 'Google Sign-In is not ready. Wait a moment and try again.';
            errEl.classList.add('show');
        }
        return;
    }
    armLoginPendingTimeout();
    try {
        client.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
        clearLoginPending();
        showLoginError('Could not open Google Sign-In. Allow pop-ups and try again.');
        console.warn('loginWithGoogle', err);
    }
}

function showLoginError(msg) {
    const errEl = document.getElementById('login-error');
    if (!errEl) return;
    errEl.textContent = msg || 'Sign-in failed';
    errEl.classList.add('show');
}

function updateCloudUI() {
    updateProfileUI();
    applyAuthGate();
    if (!googleClientId) {
        setCloudStatus('Cloud: host must set Client ID', 'warn');
    } else if (googleToken && isGoogleTokenValid()) {
        setCloudStatus('Cloud: signed in · auto-sync on ✓', 'ok');
    } else if (isAuthRestoring()) {
        setCloudStatus('Cloud: restoring session…');
    } else {
        setCloudStatus('Cloud: sign in required');
    }
}

async function fetchGoogleProfile() {
    if (!googleToken) return null;
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: 'Bearer ' + googleToken }
        });
        if (!res.ok) return null;
        const data = await res.json();
        googleProfile = {
            name: data.name || data.given_name || '',
            picture: data.picture || '',
            email: data.email || ''
        };
        try {
            localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(googleProfile));
        } catch (_) {}
        updateProfileUI();
        return googleProfile;
    } catch (_) {
        return null;
    }
}

function persistGoogleToken(token, expiresInSec) {
    googleToken = token;
    const ttl = (expiresInSec || 3600) * 1000;
    googleTokenExpiresAt = Date.now() + ttl - 60000;
    try {
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({
            token: googleToken,
            expiresAt: googleTokenExpiresAt
        }));
    } catch (_) {}
}

function clearPersistedGoogleToken(opts) {
    const keepProfile = !!(opts && opts.keepProfile);
    googleToken = null;
    googleTokenExpiresAt = 0;
    cloudFileId = null;
    try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch (_) {}
    if (!keepProfile) {
        googleProfile = null;
        try { localStorage.removeItem(PROFILE_STORAGE_KEY); } catch (_) {}
    }
}

function loadPersistedGoogleToken() {
    try {
        const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || !data.token) return false;
        googleToken = data.token;
        googleTokenExpiresAt = data.expiresAt || 0;
        try {
            const pr = localStorage.getItem(PROFILE_STORAGE_KEY);
            if (pr) googleProfile = JSON.parse(pr);
        } catch (_) {}
        return true;
    } catch (_) {
        return false;
    }
}

function isGoogleTokenValid() {
    return !!(googleToken && Date.now() < googleTokenExpiresAt);
}

function needsScopeReconsent() {
    try {
        return localStorage.getItem(SCOPE_VERSION_KEY) !== SCOPE_VERSION;
    } catch (_) {
        return true;
    }
}

function markScopesGranted() {
    try { localStorage.setItem(SCOPE_VERSION_KEY, SCOPE_VERSION); } catch (_) {}
}

function tokenHasDriveScope(resp) {
    const s = (resp && resp.scope) ? String(resp.scope) : '';
    if (!s) return true;
    return /drive\.appdata|drive\.file|drive/i.test(s);
}

function ensureGoogleTokenClient(silent) {
    if (!googleClientId) {
        if (!silent) alert('Google sync is not configured yet.');
        return null;
    }
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        if (!silent) alert('Google Sign-In is still loading. Wait a second and try again.');
        return null;
    }
    if (!googleTokenClient) {
        googleTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: googleClientId,
            scope: CLOUD_SCOPE,
            include_granted_scopes: true,
            callback: async (resp) => {
                if (resp.error) {
                    clearLoginPending();
                    clearPersistedGoogleToken({ keepProfile: false });
                    failAuthRefresh('Cloud: ' + (resp.error_description || resp.error));
                    showLoginError(resp.error_description || resp.error || 'Sign-in failed');
                    return;
                }
                clearLoginPending();
                authRefreshing = false;
                authRefreshStartedAt = 0;
                clearAuthRefreshTimers();
                hideRestoreOverlay();
                if (!tokenHasDriveScope(resp)) {
                    clearPersistedGoogleToken({ keepProfile: true });
                    failAuthRefresh('Cloud: Drive access required');
                    showLoginError('Drive access is required for cloud sync. Please check the Google Drive box and try again.');
                    return;
                }
                persistGoogleToken(resp.access_token, resp.expires_in);
                markScopesGranted();
                applyAuthGate();
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById('projects-view')?.classList.add('active');
                updateProfileUI();
                setCloudStatus('Cloud: signed in — syncing…', 'ok');
                try { await fetchGoogleProfile(); } catch (_) {}
                try { tryFinishPendingProActivation(); } catch (_) {}
                try {
                    await cloudSyncOnSignIn({ free: true });
                } catch (err) {
                    console.warn('cloudSyncOnSignIn after login', err);
                    setCloudStatus('Cloud: signed in (sync later)', 'warn');
                }
                try { await verifySubscriptionOnAccess(); } catch (_) {}
                if (isAuthed()) {
                    document.getElementById('login-view')?.classList.remove('active');
                    if (!document.querySelector('.view.active:not(#login-view)')) {
                        document.getElementById('projects-view')?.classList.add('active');
                    }
                    void (typeof window.renderProjects === "function" && window.renderProjects());
                }
                const shared = tryLoadSharedPlay();
                if (shared && isAuthed()) {
                    openProject(shared);
                    setTimeout(() => startPlayMode(), 250);
                }
            },
        });
    }
    return googleTokenClient;
}

function requestGoogleTokenWithScopes(opts) {
    const client = ensureGoogleTokenClient(!!(opts && opts.silent));
    if (!client) return false;
    const forceConsent = !!(opts && opts.forceConsent) || needsScopeReconsent();
    client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
    return true;
}

function googleSignInOrOut() {
    const reallySignedIn = !!(googleToken && isGoogleTokenValid());
    if (reallySignedIn) {
        if (!confirm('Sign out? You will need to sign in again to use LuaX.')) return;
        try {
            if (googleToken && typeof google !== 'undefined' && google.accounts?.oauth2?.revoke) {
                google.accounts.oauth2.revoke(googleToken, () => {});
            }
        } catch (_) {}
        authRefreshing = false;
        authRefreshStartedAt = 0;
        clearAuthRefreshTimers();
        clearLoginPending();
        hideRestoreOverlay();
        clearPersistedGoogleToken({ keepProfile: false });
        updateCloudUI();
        setCloudStatus('Cloud: signed out');
        applyAuthGate();
        return;
    }

    authRefreshing = false;
    authRefreshStartedAt = 0;
    clearAuthRefreshTimers();
    hideRestoreOverlay();
    if (googleToken || !isGoogleTokenValid()) {
        clearPersistedGoogleToken({ keepProfile: true });
        googleToken = null;
        googleTokenExpiresAt = 0;
    }
    loginWithGoogle();
}

function hideRestoreOverlay() {
    try {
        const el = document.getElementById('luax-restore-overlay');
        if (el) el.remove();
    } catch (_) {}
}

function isTouchDevice() {
    try {
        return window.matchMedia('(pointer: coarse)').matches ||
            ('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0);
    } catch (_) {
        return false;
    }
}

function bindTap(el, fn) {
    if (!el) return;
    var locked = false;
    function run(e) {
        if (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        }
        if (locked) return;
        locked = true;
        setTimeout(function () { locked = false; }, 600);
        try { fn(e); } catch (err) { console.warn(err); }
    }
    el.addEventListener('click', run, true);
    el.addEventListener('touchend', run, { capture: true, passive: false });
}

function showRestoreOverlay() {
    hideRestoreOverlay();
    try {
        const el = document.createElement('div');
        el.id = 'luax-restore-overlay';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-live', 'polite');
        el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(8,8,14,0.82);pointer-events:auto;touch-action:manipulation;-webkit-user-select:none;user-select:none;';
        el.innerHTML =
            '<div style="max-width:340px;width:100%;background:#16131f;border:1px solid rgba(139,92,246,0.35);border-radius:16px;padding:22px 20px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,0.45);pointer-events:auto;touch-action:manipulation">' +
            '<div style="font-size:1.05rem;font-weight:700;color:#e8e6f0;margin-bottom:8px">Restoring session…</div>' +
            '<p style="margin:0 0 16px;font-size:0.88rem;line-height:1.45;color:#9a96a8">Google sign-in needs a tap on mobile. Use the button below.</p>' +
            '<button type="button" id="luax-restore-signin" style="width:100%;margin-bottom:10px;min-height:48px;border:none;border-radius:12px;background:#8b5cf6;color:#fff;font-size:1rem;font-weight:600;pointer-events:auto;touch-action:manipulation">Sign in with Google</button>' +
            '<button type="button" id="luax-restore-cancel" style="width:100%;min-height:48px;border:none;border-radius:12px;background:#2a2a35;color:#ddd;font-size:0.95rem;pointer-events:auto;touch-action:manipulation">Cancel</button>' +
            '</div>';
        // Only stopPropagation on the backdrop itself — never block the buttons
        // (capture-phase stop on the parent was swallowing taps on Sign in / Cancel).
        el.addEventListener('click', function (e) {
            if (e.target === el) e.stopPropagation();
        }, true);
        el.addEventListener('touchend', function (e) {
            if (e.target === el) {
                try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            }
        }, { capture: true, passive: false });
        document.body.appendChild(el);
        bindTap(document.getElementById('luax-restore-signin'), function () {
            authRefreshing = false;
            clearAuthRefreshTimers();
            hideRestoreOverlay();
            clearPersistedGoogleToken({ keepProfile: true });
            googleToken = null;
            googleTokenExpiresAt = 0;
            applyAuthGate();
            updateProfileUI();
            try { loginWithGoogle(); } catch (err) {
                console.warn(err);
                alert('Google Sign-In failed to open. Check that https://luax.pages.dev is in Google Cloud Authorized JavaScript origins.');
            }
        });
        bindTap(document.getElementById('luax-restore-cancel'), function () {
            authRefreshing = false;
            clearAuthRefreshTimers();
            hideRestoreOverlay();
            clearPersistedGoogleToken({ keepProfile: false });
            googleToken = null;
            googleTokenExpiresAt = 0;
            setCloudStatus('Cloud: sign in required', 'warn');
            applyAuthGate();
            updateProfileUI();
        });
    } catch (err) {
        console.warn('showRestoreOverlay', err);
    }
}

function tryRestoreGoogleSession() {
    try {
        if (!googleProfile) {
            const pr = localStorage.getItem(PROFILE_STORAGE_KEY);
            if (pr) googleProfile = JSON.parse(pr);
        }
    } catch (_) {}

    const hadToken = loadPersistedGoogleToken();

    if (hadToken && isGoogleTokenValid()) {
        authRefreshing = false;
        clearAuthRefreshTimers();
        hideRestoreOverlay();
        updateCloudUI();
        setCloudStatus('Cloud: welcome back — syncing…', 'ok');
        tryFinishPendingProActivation();
        fetchGoogleProfile()
            .then(() => {
                tryFinishPendingProActivation();
                return verifySubscriptionOnAccess();
            })
            .catch(() => {});
        cloudSyncOnSignIn({ free: true }).catch(() => {});
        applyAuthGate();
        return;
    }

    if (!hadToken && !hasRememberedProfile()) {
        authRefreshing = false;
        clearAuthRefreshTimers();
        hideRestoreOverlay();
        updateCloudUI();
        applyAuthGate();
        return;
    }

    authRestoreAttempt += 1;
    authRefreshing = true;
    authRefreshStartedAt = Date.now();
    clearPersistedGoogleToken({ keepProfile: true });
    googleToken = null;
    googleTokenExpiresAt = 0;
    clearAuthRefreshTimers();
    updateCloudUI();
    setCloudStatus('Cloud: restoring session…');
    showRestoreOverlay();
    try {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const login = document.getElementById('login-view');
        if (login) login.classList.add('active');
    } catch (_) {}

    authRefreshWatchdog = setInterval(() => {
        if (!authRefreshing) {
            clearAuthRefreshTimers();
            return;
        }
        if (googleToken && isGoogleTokenValid()) {
            authRefreshing = false;
            clearAuthRefreshTimers();
            hideRestoreOverlay();
            return;
        }
        if (Date.now() - authRefreshStartedAt >= AUTH_REFRESH_MAX_MS) {
            failAuthRefresh('Cloud: session expired — sign in again');
        }
    }, 1000);

    if (isTouchDevice()) {
        return;
    }

    const waitForGis = (attempts) => {
        if (!authRefreshing) return;
        if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
            const client = ensureGoogleTokenClient(true);
            if (client) {
                try {
                    client.requestAccessToken({ prompt: needsScopeReconsent() ? 'consent' : '' });
                } catch (err) {
                    console.warn('silent token request failed', err);
                    failAuthRefresh('Cloud: sign in required');
                }
            } else {
                failAuthRefresh('Cloud: sign in required');
            }
            return;
        }
        if (attempts <= 0) {
            failAuthRefresh('Cloud: sign in required');
            return;
        }
        authGisWaitTimer = setTimeout(() => waitForGis(attempts - 1), 300);
    };
    waitForGis(25);
}

let scopeReauthInFlight = false;

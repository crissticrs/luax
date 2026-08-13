// src/auth.js — Google sign-in, session restore, auth gate

const GOOGLE_CLIENT_ID = '996784289780-lrl7mub599dn6eti14h3nvfre2ov6027.apps.googleusercontent.com';

const CLOUD_FILE_NAME = 'luadeck_projects.json';
// openid + profile + email + Drive appData (private app folder)
const CLOUD_SCOPE = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.appdata';
const TOKEN_STORAGE_KEY = 'luadeck_google_token';
const PROFILE_STORAGE_KEY = 'luadeck_google_profile';
const SCOPE_VERSION_KEY = 'luadeck_oauth_scope_v';
const SCOPE_VERSION = '2'; // bump when scopes change → force re-consent once

let googleClientId = GOOGLE_CLIENT_ID || localStorage.getItem('luadeck_google_client_id') || '';
let googleToken = null;
let googleTokenExpiresAt = 0;
let googleTokenClient = null;
let googleProfile = null; // { name, picture, email }
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
    } else if (authRefreshing && hasRememberedProfile()) {
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

let authRefreshing = false; // silent token refresh in progress
let authRefreshStartedAt = 0;
const AUTH_REFRESH_MAX_MS = 6000; // soft-auth only this long, then show login
let authRefreshWatchdog = null;

function hasRememberedProfile() {
    return !!(googleProfile && (googleProfile.email || googleProfile.name || googleProfile.picture));
}

function isAuthed() {
    // Only a live, unexpired Google token counts as signed in
    if (googleToken && isGoogleTokenValid()) return true;
    // Brief grace while silent refresh runs (not a permanent bypass)
    if (authRefreshing && hasRememberedProfile()) {
        if (Date.now() - authRefreshStartedAt < AUTH_REFRESH_MAX_MS) return true;
    }
    return false;
}

/** Guest play from a #play= share link — no Google account required */
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
    if (authRefreshWatchdog) {
        clearTimeout(authRefreshWatchdog);
        authRefreshWatchdog = null;
    }
    // Drop expired token; keep profile only for display on the login card if you want —
    // but gate must lock. Clear token for sure.
    if (!(googleToken && isGoogleTokenValid())) {
        clearPersistedGoogleToken({ keepProfile: true });
        googleToken = null;
        googleTokenExpiresAt = 0;
    }
    setCloudStatus(reason || 'Cloud: sign in required', 'warn');
    applyAuthGate();
}

function applyAuthGate() {
    // Shared #play= links can run without signing in
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
    // Prefer full consent when scopes may be incomplete so Drive appData is granted
    // and we do not get a token that immediately fails cloud sync (login loop).
    const forceConsent = needsScopeReconsent() || !(hasRememberedProfile() || localStorage.getItem(TOKEN_STORAGE_KEY));
    client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
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
    } else if (authRefreshing) {
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
    googleTokenExpiresAt = Date.now() + ttl - 60000; // refresh 1 min early
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

function ensureGoogleTokenClient(silent) {
    if (!googleClientId) {
        if (!silent) {
            alert('Google sync is not configured yet.');
        }
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
                    // Silent refresh failed or user denied → always show login
                    clearPersistedGoogleToken({ keepProfile: false });
                    failAuthRefresh('Cloud: ' + (resp.error_description || resp.error));
                    showLoginError(resp.error_description || resp.error || 'Sign-in failed');
                    return;
                }
                authRefreshing = false;
                authRefreshStartedAt = 0;
                if (authRefreshWatchdog) {
                    clearTimeout(authRefreshWatchdog);
                    authRefreshWatchdog = null;
                }
                persistGoogleToken(resp.access_token, resp.expires_in);
                markScopesGranted();
                // Unlock UI immediately so the user never bounces back to login
                // if a later cloud/Drive call fails or re-prompts for scopes.
                authRefreshing = false;
                applyAuthGate();
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById('projects-view')?.classList.add('active');
                updateProfileUI();
                setCloudStatus('Cloud: signed in — syncing…', 'ok');
                try {
                    await fetchGoogleProfile();
                } catch (_) {}
                try { tryFinishPendingProActivation(); } catch (_) {}
                try {
                    await cloudSyncOnSignIn({ free: true });
                } catch (err) {
                    console.warn('cloudSyncOnSignIn after login', err);
                    setCloudStatus('Cloud: signed in (sync later)', 'warn');
                }
                try {
                    await verifySubscriptionOnAccess();
                } catch (_) {}
                // Keep projects view even if something above called applyAuthGate
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

/** Force a one-time re-consent so Drive appData scope is actually on the token */
function requestGoogleTokenWithScopes(opts) {
    const client = ensureGoogleTokenClient(!!(opts && opts.silent));
    if (!client) return false;
    const forceConsent = !!(opts && opts.forceConsent) || needsScopeReconsent();
    client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
    return true;
}

function googleSignInOrOut() {
    // Only a live, valid token means "signed in". A remembered profile alone is NOT signed in
    // (that was the bug: menu said "Not signed in" / "Sign in" but click asked to sign out).
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
        if (authRefreshWatchdog) {
            clearTimeout(authRefreshWatchdog);
            authRefreshWatchdog = null;
        }
        clearPersistedGoogleToken({ keepProfile: false });
        updateCloudUI();
        setCloudStatus('Cloud: signed out');
        applyAuthGate();
        return;
    }

    // Stale / expired token or leftover profile → clean session state, then sign in
    authRefreshing = false;
    authRefreshStartedAt = 0;
    if (authRefreshWatchdog) {
        clearTimeout(authRefreshWatchdog);
        authRefreshWatchdog = null;
    }
    if (googleToken || !isGoogleTokenValid()) {
        clearPersistedGoogleToken({ keepProfile: true });
        googleToken = null;
        googleTokenExpiresAt = 0;
    }
    loginWithGoogle();
}

/** Restore session on page load — stay signed in only with a valid token */
function tryRestoreGoogleSession() {
    // Always try to load remembered profile for UI (avatar / email on login)
    try {
        if (!googleProfile) {
            const pr = localStorage.getItem(PROFILE_STORAGE_KEY);
            if (pr) googleProfile = JSON.parse(pr);
        }
    } catch (_) {}

    const hadToken = loadPersistedGoogleToken();

    // Valid token → fully signed in
    if (hadToken && isGoogleTokenValid()) {
        authRefreshing = false;
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
        return;
    }

    // No token / expired: attempt silent refresh briefly, then MUST show login if it fails
    if (!hadToken && !hasRememberedProfile()) {
        authRefreshing = false;
        updateCloudUI(); // applyAuthGate → login view
        return;
    }

    authRefreshing = true;
    authRefreshStartedAt = Date.now();
    // Drop expired access token from memory/storage; keep profile for silent re-auth hint
    clearPersistedGoogleToken({ keepProfile: true });
    updateCloudUI(); // soft-auth only for AUTH_REFRESH_MAX_MS
    setCloudStatus('Cloud: restoring session…');

    if (authRefreshWatchdog) clearTimeout(authRefreshWatchdog);
    authRefreshWatchdog = setTimeout(() => {
        if (googleToken && isGoogleTokenValid()) return;
        // Silent refresh never completed → force login page
        failAuthRefresh('Cloud: session expired — sign in again');
    }, AUTH_REFRESH_MAX_MS);

    const waitForGis = (attempts) => {
        if (typeof google !== 'undefined' && google.accounts?.oauth2) {
            const client = ensureGoogleTokenClient(true);
            if (client) {
                client.requestAccessToken({ prompt: needsScopeReconsent() ? 'consent' : '' });
            } else {
                failAuthRefresh('Cloud: sign in required');
            }
            return;
        }
        if (attempts <= 0) {
            failAuthRefresh('Cloud: sign in required');
            return;
        }
        setTimeout(() => waitForGis(attempts - 1), 400);
    };
    waitForGis(30);
}

let scopeReauthInFlight = false;


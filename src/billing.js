// src/billing.js — Pro, Stripe, credits

// CREDITS — mainly free; limits only cloud + export
// ============================================================
const CREDITS_KEY = 'luax_credits_state';
const PRO_KEY = 'luax_pro_status';
const CREDIT_COSTS = { cloud_save: 2, export: 2 };
const CREDIT_WEEKLY_FREE = 25;
const CREDIT_WEEKLY_PRO = 250;

// ---------------------------------------------------------------
// STRIPE (€5 / month) — Apple Pay & Google Pay appear in Checkout
// when enabled in the Stripe Dashboard (no extra code needed).
//
// SETUP (once):
// 1. https://dashboard.stripe.com → Products → Add product
//    Name: LuaX Pro · Pricing: €5.00 / month recurring
// 2. Create a Payment Link for that price (Payment Links)
//    After payment → redirect to your site URL with ?pro=success
//    e.g. https://yoursite.netlify.app/?pro=success
// 3. Paste the Payment Link below into STRIPE_PAYMENT_LINK
// 4. (Optional) Settings → Billing → Customer portal → activate,
//    then paste the portal login link into STRIPE_PORTAL_LINK
// 5. Settings → Payment methods → enable Apple Pay + Google Pay
//    (Apple Pay needs your domain added under Apple Pay domains)
//
// NOTE: Without a server webhook, Pro is activated on return from
// Checkout (tied to the signed-in Google email). For production,
// add a webhook that confirms subscription status by email.
// ---------------------------------------------------------------
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/fZu7sKgHmckY0W5fiY3Je00';
const STRIPE_PORTAL_LINK = 'https://billing.stripe.com/p/login/fZu7sKgHmckY0W5fiY3Je00';
// Optional: your backend that returns { "active": true/false, "activeUntil": "ISO" }
// Leave empty to use local Pro status (email match + activeUntil window).
// See /luax-stripe-worker in this project for a ready-to-deploy
// Cloudflare Worker implementing this endpoint from real Stripe webhooks.
const STRIPE_STATUS_ENDPOINT = 'https://luax-stripe.lua-x.workers.dev/status';
const STRIPE_CANCEL_ENDPOINT = 'https://luax-stripe.lua-x.workers.dev/cancel';
const STRIPE_CREDITS_ENDPOINT = 'https://luax-stripe.lua-x.workers.dev/credits';
const STRIPE_CREDITS_CONSUME_ENDPOINT = 'https://luax-stripe.lua-x.workers.dev/credits/consume';
// /status is gated by Google access token (Authorization: Bearer).
// STRIPE_STATUS_KEY unused (kept for compatibility with older notes).
const STRIPE_STATUS_KEY = '';

function weekId() {
    const d = new Date();
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return tmp.getUTCFullYear() + '-W' + week;
}

function currentAccountEmail() {
    return (googleProfile && googleProfile.email) ? String(googleProfile.email).toLowerCase() : '';
}

function loadProStatus() {
    try {
        const raw = localStorage.getItem(PRO_KEY);
        if (!raw) return null;
        // migrate old '1' flag
        if (raw === '1') return { active: true, email: '', source: 'legacy' };
        const data = JSON.parse(raw);
        return (data && typeof data === 'object') ? data : null;
    } catch (_) {
        return null;
    }
}

function isPro() {
    const st = loadProStatus();
    if (!st || !st.active) return false;
    const email = currentAccountEmail();
    // If we know the account email, Pro must match that account
    if (email && st.email && st.email !== email) return false;
    // Optional period end (set by verify / payment return)
    if (st.activeUntil) {
        const end = Date.parse(st.activeUntil);
        if (!isNaN(end) && Date.now() > end) return false;
    }
    return true;
}

function setPro(on, meta) {
    try {
        if (on) {
            const email = (meta && meta.email) || currentAccountEmail();
            const prev = loadProStatus() || {};
            // Prefer Stripe period end from worker. Do NOT invent a "month"
            // when we don't know — that misleads trial users.
            let activeUntil = (meta && meta.activeUntil) || prev.activeUntil || null;
            const trial = !!(meta && meta.trial) || (!!(prev.trial) && !(meta && meta.trial === false));
            const status = (meta && meta.status) || prev.status || (trial ? 'trialing' : 'active');
            const cancelAtPeriodEnd = (meta && typeof meta.cancelAtPeriodEnd === 'boolean')
                ? meta.cancelAtPeriodEnd
                : !!prev.cancelAtPeriodEnd;
            localStorage.setItem(PRO_KEY, JSON.stringify({
                active: true,
                email: email || prev.email || '',
                source: (meta && meta.source) || prev.source || 'stripe',
                since: (meta && meta.since) || prev.since || new Date().toISOString(),
                activeUntil: activeUntil,
                trial: !!trial,
                status: status,
                cancelAtPeriodEnd: !!cancelAtPeriodEnd,
                lastVerified: new Date().toISOString()
            }));
        } else {
            localStorage.removeItem(PRO_KEY);
        }
    } catch (_) {}
    updateProfileUI();
    try { renderBillingPanel(); } catch (_) {}
}

/**
 * Run on every site open after auth is known.
 * - Wrong account email → Free
 * - activeUntil expired → Free
 * - Optional STRIPE_STATUS_ENDPOINT can confirm live Stripe status
 */
async function verifySubscriptionOnAccess() {
    const st = loadProStatus() || null;
    const email = currentAccountEmail() || (st && st.email) || '';

    // Always ask Stripe worker when configured — can GRANT Pro after re-login.
    // (Bug before: only checked server when local Pro was already on, so a
    // logout during checkout left paid users stuck on Free.)
    if (typeof STRIPE_STATUS_ENDPOINT === 'string' && STRIPE_STATUS_ENDPOINT && email) {
        try {
            // /status requires a Google token for this app — no public email probing
            if (!(googleToken && isGoogleTokenValid())) {
                try { renderBillingPanel(); } catch (_) {}
                return { active: !!(st && st.active), reason: 'not_signed_in_for_status' };
            }
            const res = await fetch(
                STRIPE_STATUS_ENDPOINT + (STRIPE_STATUS_ENDPOINT.includes('?') ? '&' : '?') +
                'email=' + encodeURIComponent(email),
                {
                    method: 'GET',
                    credentials: 'omit',
                    headers: { 'Authorization': 'Bearer ' + googleToken }
                }
            );
            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data && data.active === true) {
                    setPro(true, {
                        email: email,
                        source: 'stripe_verify',
                        since: (st && st.since) || new Date().toISOString(),
                        activeUntil: data.activeUntil || (st && st.activeUntil) || null,
                        trial: !!data.trial,
                        status: data.status || (data.trial ? 'trialing' : 'active'),
                        cancelAtPeriodEnd: !!data.cancelAtPeriodEnd
                    });
                    try { renderBillingPanel(); } catch (_) {}
                    return { active: true, reason: 'stripe_ok' };
                }
                if (data && data.active === false) {
                    if (st && st.active) setPro(false);
                    try { renderBillingPanel(); } catch (_) {}
                    return { active: false, reason: 'stripe_inactive' };
                }
            }
        } catch (_) {
            // Network error: fall through to local status
        }
    }

    if (!st || !st.active) {
        try { renderBillingPanel(); } catch (_) {}
        return { active: false, reason: 'none' };
    }

    if (email && st.email && st.email !== email) {
        setPro(false);
        return { active: false, reason: 'email_mismatch' };
    }

    if (st.activeUntil) {
        const end = Date.parse(st.activeUntil);
        if (!isNaN(end) && Date.now() > end) {
            setPro(false);
            return { active: false, reason: 'expired' };
        }
    }

    try {
        const next = { ...st, lastVerified: new Date().toISOString() };
        localStorage.setItem(PRO_KEY, JSON.stringify(next));
    } catch (_) {}
    try { renderBillingPanel(); } catch (_) {}
    return { active: true, reason: 'local_ok' };
}

function startStripeCheckout() {
    if (!STRIPE_PAYMENT_LINK) {
        alert(
            'Stripe is not configured yet.\n\n' +
            'Create a €5/month Payment Link in the Stripe Dashboard and paste it into STRIPE_PAYMENT_LINK in index.html.'
        );
        return;
    }
    try { sessionStorage.setItem('luax_stripe_pending', '1'); } catch (_) {}
    try { localStorage.setItem('luax_stripe_pending', '1'); } catch (_) {}
    try { const em = currentAccountEmail(); if (em) localStorage.setItem('luax_stripe_pending_email', em); } catch (_) {}
    let url = STRIPE_PAYMENT_LINK;
    const email = currentAccountEmail();
    // Prefill email on Checkout when possible
    if (email) {
        const sep = url.includes('?') ? '&' : '?';
        url += sep + 'prefilled_email=' + encodeURIComponent(email);
        url += '&client_reference_id=' + encodeURIComponent(email);
    }
    window.location.href = url;
}

function openStripePortal() {
    if (STRIPE_PORTAL_LINK) {
        window.open(STRIPE_PORTAL_LINK, '_blank', 'noopener');
        return true;
    }
    return false;
}

/** Cancel / manage subscription — real cancel happens in Stripe Customer Portal */
function openBillingManage() {
    closeAccountMenu();
    if (openStripePortal()) return;
    openModal(
        'Manage billing',
        `<div style="font-size:0.9rem;line-height:1.45;color:var(--text-color)">
          <p style="margin:0 0 10px">To cancel or update your card, open the <b>Stripe Customer Portal</b>.</p>
          <p style="margin:0 0 8px;color:var(--muted);font-size:0.85rem">Owner setup:</p>
          <ol style="margin:0 0 10px;padding-left:18px;color:var(--muted);font-size:0.85rem">
            <li>Stripe Dashboard → Settings → Billing → Customer portal</li>
            <li>Turn the portal <b>on</b> (allow cancel subscription)</li>
            <li>Copy the portal link into <code>STRIPE_PORTAL_LINK</code> in index.html</li>
          </ol>
          <p style="margin:0;font-size:0.8rem;color:var(--muted)">Pro only unlocks after Stripe redirects back with <code>?pro=success</code>.</p>
        </div>`,
        'OK',
        () => {}
    );
}

function cancelSubscription() {
    closeAccountMenu();
    if (!isPro()) {
        openSubscriptionInfo();
        return;
    }
    if (!(googleToken && isGoogleTokenValid())) {
        alert('Sign in with Google first to cancel your subscription.');
        return;
    }
    const email = currentAccountEmail();
    openModal(
        'Cancel subscription',
        `<div style="font-size:0.9rem;line-height:1.45;color:var(--text-color)">
          <p style="margin:0 0 10px">Cancel Pro for <b>${email ? escapeHtml(email) : 'this account'}</b>?</p>
          <p style="margin:0;color:var(--muted);font-size:0.85rem">You keep Pro until the end of the current billing period. No further charges after that. Only the signed-in Google account can cancel its own plan.</p>
        </div>`,
        'Cancel at period end',
        () => { doCancelSubscription(); }
    );
}

async function doCancelSubscription() {
    if (!(googleToken && isGoogleTokenValid())) {
        alert('Sign in with Google first to cancel your subscription.');
        return;
    }
    const endpoint = (typeof STRIPE_CANCEL_ENDPOINT === 'string' && STRIPE_CANCEL_ENDPOINT)
        ? STRIPE_CANCEL_ENDPOINT
        : (STRIPE_STATUS_ENDPOINT ? STRIPE_STATUS_ENDPOINT.replace(/\/status\/?$/, '/cancel') : '');
    if (!endpoint) {
        alert('Cancel is not configured (missing worker URL).');
        return;
    }
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            credentials: 'omit',
            headers: {
                'Authorization': 'Bearer ' + googleToken,
                'Content-Type': 'application/json'
            },
            body: '{}'
        });
        let data = {};
        try { data = await res.json(); } catch (_) { data = {}; }
        if (res.status === 404) {
            alert('Cancel is not available on the server yet. Redeploy the worker (worker.js with POST /cancel), then try again.');
            return;
        }
        if (!res.ok || !data.ok) {
            const err = (data && data.error) || ('HTTP ' + res.status);
            if (err === 'not_signed_in' || err === 'invalid_google_token') {
                alert('Please sign in with Google again, then cancel.');
            } else {
                alert('Could not cancel: ' + err);
            }
            return;
        }
        // Keep Pro until period end — refresh from worker (still active + cancelAtPeriodEnd)
        try { await verifySubscriptionOnAccess(); } catch (_) {}
        try { renderBillingPanel(); } catch (_) {}
        try { renderProPage(); } catch (_) {}
        const st = loadProStatus() || {};
        const until = st.activeUntil ? new Date(st.activeUntil).toLocaleDateString() : '';
        alert(
            until
                ? ('Cancellation scheduled. You keep Pro until ' + until + ', then the Free plan starts. No further charges.')
                : 'Cancellation scheduled. You keep Pro until the end of the current period, then the Free plan starts.'
        );
    } catch (e) {
        alert('Network error while cancelling. Usually the worker is missing POST /cancel or CORS. Redeploy worker.js, hard-refresh the app, try again.');
    }
}

function renderBillingPanel() {
    const el = document.getElementById('billing-panel');
    if (!el) return;
    const pro = isPro();
    const st = loadProStatus();
    const email = currentAccountEmail() || (st && st.email) || '';
    const since = st && st.since ? new Date(st.since).toLocaleDateString() : '';

    if (pro) {
        const isTrial = !!(st && (st.trial || st.status === 'trialing'));
        const until = st && st.activeUntil ? new Date(st.activeUntil).toLocaleDateString() : '';
        el.innerHTML = `
            <p class="billing-status pro">LuaX Pro · ${isTrial ? 'trial' : 'subscription'}</p>
            <p class="billing-meta">
              ${email ? 'Account: ' + escapeHtml(email) + '<br>' : ''}
              ${since ? 'Since: ' + since + '<br>' : ''}
              ${until ? (isTrial ? 'Trial ends: ' : 'Period ends: ') + until + '<br>' : ''}
              ${CREDIT_WEEKLY_PRO} credits / week · €5 / month
            </p>
            <div class="billing-actions">
              <button type="button" class="btn btn-primary btn-sm" onclick="openBillingManage()">Manage billing</button>
              <button type="button" class="btn btn-sm btn-danger-outline" onclick="cancelSubscription()">Cancel subscription</button>
            </div>
            <p class="lx-hint" style="margin-top:10px;margin-bottom:0">Cancel only through Stripe Customer Portal so billing and app status stay in sync.</p>`;
    } else {
        el.innerHTML = `
            <p class="billing-status free">Free plan</p>
            <p class="billing-meta">${CREDIT_WEEKLY_FREE} credits / week · upgrade anytime for ${CREDIT_WEEKLY_PRO}/week</p>
            <p class="billing-email-warn" role="alert">Important: Your billing email must match your LuaX account email. If using Apple Pay / Google Pay, check the email on Stripe’s form before making a purchase, or Pro won’t unlock on this account.</p>
            <div class="billing-actions">
              <button type="button" class="btn btn-primary btn-sm" onclick="openSubscriptionInfo()">Upgrade to Pro — €5/mo</button>
              ${STRIPE_PORTAL_LINK ? '<button type="button" class="btn btn-sm" onclick="openBillingManage()">Open billing portal</button>' : ''}
            </div>`;
    }
}

/**
 * Unlock Pro after Stripe checkout.
 * Requires either a live Google session or a remembered profile (token may still be restoring).
 * Returns false if auth is not ready yet — caller can retry.
 */
function activateProAfterPayment(source) {
    // Token may still be refreshing after redirect; remembered profile is enough
    const ready = isAuthed() || hasRememberedProfile() || !!currentAccountEmail();
    if (!ready) {
        // Do not alert here — auth is often still loading after Stripe redirect
        return false;
    }
    setPro(true, { source: source || 'stripe', email: currentAccountEmail() });
    try {
        sessionStorage.removeItem('luax_stripe_pending');
        sessionStorage.removeItem('luax_stripe_activate');
    } catch (_) {}
    updateProfileUI();
    try { renderBillingPanel(); } catch (_) {}
    return true;
}

function cleanStripeParamsFromUrl() {
    try {
        const url = new URL(window.location.href);
        ['pro', 'payment', 'redirect_status', 'session_id'].forEach(k => url.searchParams.delete(k));
        const qs = url.searchParams.toString();
        window.history.replaceState({}, '', url.pathname + (qs ? '?' + qs : '') + url.hash);
    } catch (_) {
        try {
            window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        } catch (__) {}
    }
}

function hadStripeCheckoutPending() {
    try {
        return sessionStorage.getItem('luax_stripe_pending') === '1' ||
            sessionStorage.getItem('luax_stripe_activate') === '1' ||
            localStorage.getItem('luax_stripe_pending') === '1' ||
            localStorage.getItem('luax_stripe_activate') === '1';
    } catch (_) {
        return false;
    }
}

/**
 * Apply a pending Pro unlock once Google session is available.
 * Called from boot timeout and after successful sign-in / session restore.
 */
function tryFinishPendingProActivation() {
    let need = false;
    try { need = sessionStorage.getItem('luax_stripe_activate') === '1'; } catch (_) {}
    if (!need) return false;
    if (!(isAuthed() || hasRememberedProfile())) return false;
    if (activateProAfterPayment('stripe_return')) {
        setTimeout(() => {
            alert('Welcome to LuaX Pro! Your higher credit limit is active on this account.');
        }, 200);
        return true;
    }
    return false;
}

/**
 * Handle return from Stripe Checkout.
 *
 * luax_stripe_pending is only a UX filter (reduces noise from bare /?pro=success).
 * It is NOT a security gate — anyone can set that flag in devtools.
 * Real security is verifySubscriptionOnAccess() → worker /status (Stripe webhook → KV).
 * A forged local Pro is cleared on the next load when the worker has no sub for that email.
 */
function handleStripeReturn() {
    try {
        const params = new URLSearchParams(window.location.search);
        const proFlag = params.get('pro');
        const payment = params.get('payment');
        const redirectStatus = params.get('redirect_status');
        const sessionId = params.get('session_id');
        const success =
            proFlag === 'success' || proFlag === '1' ||
            payment === 'success' ||
            redirectStatus === 'succeeded' ||
            !!sessionId;

        if (success) {
            cleanStripeParamsFromUrl();

            // UX filter only (not security — see comment above)
            if (!hadStripeCheckoutPending()) {
                return false;
            }

            try { sessionStorage.setItem('luax_stripe_activate', '1'); } catch (_) {}
            try { localStorage.setItem('luax_stripe_activate', '1'); } catch (_) {}

            if (activateProAfterPayment('stripe_return')) {
                setTimeout(() => {
                    alert('Welcome to LuaX Pro! Your higher credit limit is active on this account.');
                }, 300);
            }
            // else: auth still loading — tryFinishPendingProActivation() will finish it
            return true;
        }
        if (
            proFlag === 'cancel' || proFlag === 'canceled' ||
            payment === 'cancelled' || payment === 'canceled' ||
            redirectStatus === 'failed' ||
            params.get('billing') === 'canceled'
        ) {
            try {
                sessionStorage.removeItem('luax_stripe_pending');
                sessionStorage.removeItem('luax_stripe_activate');
            } catch (_) {}
            cleanStripeParamsFromUrl();
            return false;
        }
    } catch (_) {}
    return false;
}

function loadCreditsState() {
    const wid = weekId();
    let st = null;
    try { st = JSON.parse(localStorage.getItem(CREDITS_KEY) || 'null'); } catch (_) { st = null; }
    const weekly = isPro() ? CREDIT_WEEKLY_PRO : CREDIT_WEEKLY_FREE;
    if (!st || st.week !== wid) {
        st = { week: wid, used: 0 };
        try { localStorage.setItem(CREDITS_KEY, JSON.stringify(st)); } catch (_) {}
    }
    // Prefer last server snapshot for this week when present
    try {
        const srv = JSON.parse(localStorage.getItem(CREDITS_KEY + '_server') || 'null');
        if (srv && srv.week === wid && typeof srv.used === 'number') {
            st.used = Math.max(st.used || 0, srv.used);
        }
    } catch (_) {}
    return { ...st, weekly, left: Math.max(0, weekly - (st.used || 0)) };
}

function saveCreditsState(st) {
    try { localStorage.setItem(CREDITS_KEY, JSON.stringify({ week: st.week, used: st.used })); } catch (_) {}
}

function applyServerCredits(data) {
    if (!data || typeof data.used !== 'number') return;
    const wid = data.week || weekId();
    const used = Math.max(0, data.used);
    try {
        localStorage.setItem(CREDITS_KEY, JSON.stringify({ week: wid, used: used }));
        localStorage.setItem(CREDITS_KEY + '_server', JSON.stringify({ week: wid, used: used, at: Date.now() }));
    } catch (_) {}
    try { updateProfileUI(); } catch (_) {}
}

/** Pull weekly usage from worker (source of truth). Call after sign-in. */
async function refreshCreditsFromServer() {
    if (!(googleToken && isGoogleTokenValid())) return null;
    if (!STRIPE_CREDITS_ENDPOINT) return null;
    try {
        const res = await fetch(STRIPE_CREDITS_ENDPOINT, {
            method: 'GET',
            credentials: 'omit',
            headers: { 'Authorization': 'Bearer ' + googleToken }
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        if (data && data.ok) {
            applyServerCredits(data);
            return data;
        }
    } catch (_) {}
    return null;
}

/**
 * Spend credits. When signed in, worker is source of truth (devtools localStorage reset won't help).
 * Returns true/false; may be async — callers should await.
 */
async function spendCredits(action, opts) {
    const cost = CREDIT_COSTS[action] || 0;
    if (cost <= 0) return true;

    // Server path when signed in
    if (googleToken && isGoogleTokenValid() && STRIPE_CREDITS_CONSUME_ENDPOINT) {
        try {
            const res = await fetch(STRIPE_CREDITS_CONSUME_ENDPOINT, {
                method: 'POST',
                credentials: 'omit',
                headers: {
                    'Authorization': 'Bearer ' + googleToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ cost: cost })
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 402 || (data && data.error === 'insufficient')) {
                if (!opts || !opts.silent) {
                    const left = (data && typeof data.left === 'number') ? data.left : 0;
                    alert(
                        'Not enough credits this week.\n\n' +
                        'Need ' + cost + ' · you have ' + left + ' left.\n\n' +
                        'Free: ' + CREDIT_WEEKLY_FREE + '/week · Pro (€5/mo): ' + CREDIT_WEEKLY_PRO + '/week\n' +
                        'Editing & play stay free. Credits reset weekly.'
                    );
                }
                if (data && typeof data.used === 'number') applyServerCredits(data);
                return false;
            }
            if (!res.ok || !data.ok) {
                if (!opts || !opts.silent) {
                    alert('Could not verify credits (' + ((data && data.error) || res.status) + '). Try signing in again.');
                }
                return false;
            }
            applyServerCredits(data);
            return true;
        } catch (_) {
            if (!opts || !opts.silent) {
                alert('Network error checking credits. Try again.');
            }
            return false;
        }
    }

    // Not signed in — local only (login gate usually prevents this for paid actions)
    const st = loadCreditsState();
    if (st.left < cost) {
        if (!opts || !opts.silent) {
            alert(
                'Not enough credits this week.\n\n' +
                'Need ' + cost + ' · you have ' + st.left + ' left.\n\n' +
                'Free: ' + CREDIT_WEEKLY_FREE + '/week · Pro (€5/mo): ' + CREDIT_WEEKLY_PRO + '/week\n' +
                'Editing & play stay free. Credits reset weekly.'
            );
        }
        return false;
    }
    st.used = (st.used || 0) + cost;
    saveCreditsState(st);
    updateProfileUI();
    return true;
}

function openSubscriptionInfo() {
    closeAccountMenu();
    try { closeModal(); } catch (_) {}
    // Remember where to return
    const active = document.querySelector('.view.active');
    window._proReturnView = (active && active.id && active.id !== 'pro-view')
        ? active.id
        : 'projects-view';
    renderProPage();
    switchView('pro-view');
    try {
        const sc = document.getElementById('pro-scroll-body');
        if (sc) sc.scrollTop = 0;
    } catch (_) {}
}

function closeProView() {
    const back = window._proReturnView || 'projects-view';
    window._proReturnView = null;
    // Prefer files/music if still in a project context
    if (back === 'pro-view' || !document.getElementById(back)) {
        switchView('projects-view');
    } else {
        switchView(back);
    }
}

function renderProPage() {
    const body = document.getElementById('pro-scroll-body');
    const title = document.getElementById('pro-page-title');
    if (!body) return;
    const pro = isPro();
    const stripeReady = !!STRIPE_PAYMENT_LINK;
    if (title) title.textContent = pro ? 'Your Pro plan' : 'Upgrade to Pro';

    const cloudCost = (typeof CREDIT_COSTS !== 'undefined' && CREDIT_COSTS.cloud_save) || 2;
    const exportCost = (typeof CREDIT_COSTS !== 'undefined' && CREDIT_COSTS.export) || 2;
    const freeCred = (typeof CREDIT_WEEKLY_FREE !== 'undefined') ? CREDIT_WEEKLY_FREE : 25;
    const proCred = (typeof CREDIT_WEEKLY_PRO !== 'undefined') ? CREDIT_WEEKLY_PRO : 250;
    const freeCh = (typeof MUS_FREE_MAX_CHANNELS !== 'undefined') ? MUS_FREE_MAX_CHANNELS : 10;
    const freeSt = (typeof MUS_FREE_MAX_STEPS !== 'undefined') ? MUS_FREE_MAX_STEPS : 16;
    const proCh = (typeof MUS_PRO_MAX_CHANNELS !== 'undefined') ? MUS_PRO_MAX_CHANNELS : 16;
    const proSt = (typeof MUS_PRO_MAX_STEPS !== 'undefined') ? MUS_PRO_MAX_STEPS : 64;

    if (pro) {
        const st = loadProStatus() || {};
        const email = currentAccountEmail() || st.email || '';
        const since = st.since ? new Date(st.since).toLocaleDateString() : '';
        const until = st.activeUntil ? new Date(st.activeUntil).toLocaleDateString() : '';
        const isTrial = !!(st.trial || st.status === 'trialing');
        const ending = !!st.cancelAtPeriodEnd;
        const planLabel = ending ? (isTrial ? 'Trial · ending' : 'Cancels at period end') : (isTrial ? 'Trial' : 'Subscription');
        let dateLine = '';
        if (ending) {
            dateLine = until
                ? ('Access until ' + until + ' · then Free (no further charges)')
                : 'Cancellation scheduled · access until period ends';
            if (since) dateLine = 'Since ' + since + ' · ' + dateLine;
        } else if (isTrial) {
            dateLine = until
                ? ('Trial ends ' + until + (since ? ' · started ' + since : ''))
                : (since ? ('Trial started ' + since + ' · end date from Stripe when available') : 'Trial active');
        } else {
            dateLine = until
                ? ((since ? 'Since ' + since + ' · ' : '') + 'Current period ends ' + until)
                : (since ? ('Since ' + since) : 'Active subscription');
        }
        body.innerHTML = `
            <div class="pro-status-card">
                <h2>✓ LuaX Pro is active</h2>
                <p><span class="pro-plan-badge ${isTrial ? 'trial' : 'paid'}">${planLabel}</span></p>
                <p>${email ? escapeHtml(email) + '<br>' : ''}${dateLine}</p>
            </div>
            <p class="pro-section-title">Your Pro benefits</p>
            <div class="pro-benefits">
                <div class="pro-benefit">
                    <div class="pro-benefit-ico">⚡</div>
                    <div>
                        <h3>${proCred} credits every week</h3>
                        <p>10× the free plan (${freeCred}/week). Cloud backup (${cloudCost}/hour) and export (${exportCost}) last much longer.</p>
                    </div>
                </div>
                <div class="pro-benefit">
                    <div class="pro-benefit-ico">🎵</div>
                    <div>
                        <h3>Bigger music grids</h3>
                        <p>Up to <b>${proCh} channels</b> and <b>${proSt} steps</b> (free is ${freeCh}×${freeSt}). Build richer sequences.</p>
                    </div>
                </div>
                <div class="pro-benefit">
                    <div class="pro-benefit-ico">☁️</div>
                    <div>
                        <h3>Faster cloud sync</h3>
                        <p>Saves push to Drive sooner so projects stay in sync across devices.</p>
                    </div>
                </div>
                <div class="pro-benefit">
                    <div class="pro-benefit-ico">📦</div>
                    <div>
                        <h3>Export without stress</h3>
                        <p>Higher weekly allowance for project exports — share and back up more often.</p>
                    </div>
                </div>
                <div class="pro-benefit">
                    <div class="pro-benefit-ico">🎮</div>
                    <div>
                        <h3>Everything else stays free</h3>
                        <p>Editor, play mode, sprite tools, and the engine itself never lock behind Pro.</p>
                    </div>
                </div>
            </div>
            <div class="pro-actions-row">
                <button type="button" class="btn btn-primary" onclick="openBillingManage()">Manage billing</button>
                <button type="button" class="btn btn-danger-outline" onclick="cancelSubscription()">Cancel subscription</button>
            </div>
            <p class="pro-cta-note">Billing is handled securely by Stripe. You can also open this from Settings → Billing.</p>
        `;
        return;
    }

    body.innerHTML = `
        <div class="pro-hero">
            <div class="pro-badge">LuaX Pro</div>
            <p class="pro-price">€5 <span>/ month</span></p>
            <p class="pro-tagline">Unlock higher limits. The editor and play engine stay free forever.</p>
        </div>

        <p class="pro-section-title">Everything you get</p>
        <div class="pro-benefits">
            <div class="pro-benefit">
                <div class="pro-benefit-ico">⚡</div>
                <div>
                    <h3>${proCred} credits / week</h3>
                    <p>Free accounts get ${freeCred}. Pro gives you <b>${proCred}</b> — enough for heavy cloud backup and many exports.</p>
                </div>
            </div>
            <div class="pro-benefit">
                <div class="pro-benefit-ico">🎵</div>
                <div>
                    <h3>Music: ${proCh} channels × ${proSt} steps</h3>
                    <p>Free tops out at ${freeCh} channels and ${freeSt} steps. Pro unlocks wider grids for complex tracks, random generator patterns, and long loops.</p>
                </div>
            </div>
            <div class="pro-benefit">
                <div class="pro-benefit-ico">☁️</div>
                <div>
                    <h3>Priority cloud backup</h3>
                    <p>Projects sync to your private Google Drive app folder more often (${cloudCost} credits/hour). Great if you switch devices.</p>
                </div>
            </div>
            <div class="pro-benefit">
                <div class="pro-benefit-ico">📤</div>
                <div>
                    <h3>More project exports</h3>
                    <p>Each export costs ${exportCost} credits. With ${proCred}/week you can ship builds and backups without running dry mid-week.</p>
                </div>
            </div>
            <div class="pro-benefit">
                <div class="pro-benefit-ico">🎲</div>
                <div>
                    <h3>Full music toolkit</h3>
                    <p>Random generator, live playhead, 10+ channels, and long step counts — all available under the higher Pro grid limits.</p>
                </div>
            </div>
            <div class="pro-benefit">
                <div class="pro-benefit-ico">💳</div>
                <div>
                    <h3>Simple billing</h3>
                    <p>Pay with card, Apple Pay, or Google Pay via Stripe. Cancel anytime in the customer portal.</p>
                </div>
            </div>
        </div>

        <p class="pro-section-title">Free vs Pro</p>
        <table class="pro-compare">
            <thead>
                <tr><th>Feature</th><th>Free</th><th>Pro</th></tr>
            </thead>
            <tbody>
                <tr>
                    <td>Weekly credits</td>
                    <td>${freeCred}</td>
                    <td class="hl">${proCred}</td>
                </tr>
                <tr>
                    <td>Music channels</td>
                    <td>up to ${freeCh}</td>
                    <td class="hl">up to ${proCh}</td>
                </tr>
                <tr>
                    <td>Music steps</td>
                    <td>up to ${freeSt}</td>
                    <td class="hl">up to ${proSt}</td>
                </tr>
                <tr>
                    <td>Cloud backup</td>
                    <td class="yes">Yes</td>
                    <td class="yes">Yes · faster</td>
                </tr>
                <tr>
                    <td>Export projects</td>
                    <td class="yes">Yes</td>
                    <td class="yes">Yes · more room</td>
                </tr>
                <tr>
                    <td>Code editor &amp; PLAY</td>
                    <td class="yes">Free</td>
                    <td class="yes">Free</td>
                </tr>
                <tr>
                    <td>Sprite &amp; music editors</td>
                    <td class="yes">Free</td>
                    <td class="yes">Free</td>
                </tr>
            </tbody>
        </table>

        <div class="pro-cta">
            <button type="button" class="btn btn-primary" id="pro-subscribe-btn"
                onclick="${stripeReady ? 'startStripeCheckout()' : 'alert(\'Stripe is not configured yet.\')'}">
                ${stripeReady ? 'Subscribe — €5/mo' : 'Stripe not configured'}
            </button>
            <p class="pro-email-warn" role="alert">
                Important: Your billing email must match your LuaX account email.<br>
                If using Apple Pay / Google Pay, check the email on Stripe’s form before making a purchase, or Pro won’t unlock on this account.
            </p>
            <p class="pro-cta-note">
                Secure checkout opens in Stripe. Apple Pay &amp; Google Pay appear when available.<br>
                Pro unlocks after payment redirects back to this site for the matching signed-in account.
            </p>
        </div>
    `;
}


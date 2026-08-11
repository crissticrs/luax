/**
 * LuaX Stripe verification worker (Cloudflare Workers + KV)
 *
 * POST /webhook  — Stripe events → KV sub:<email>
 * GET  /status?email= — { active, activeUntil, trial, status }
 * GET  /health   — config check
 *
 * Webhook: https://luax-stripe.lua-x.workers.dev/webhook
 * Status:  https://luax-stripe.lua-x.workers.dev/status
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-LuaX-Key, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      return handleStatus(request, env, url);
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return handleHealth(env);
    }
    if (request.method === 'POST' && url.pathname === '/webhook') {
      return handleWebhook(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/cancel') {
      return handleCancel(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/credits') {
      return handleCreditsGet(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/credits/consume') {
      return handleCreditsConsume(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/checkout') {
      return handleCheckout(request, env);
    }
    return new Response('Not found', { status: 404 });
  },
};


/**
 * POST /cancel
 * Authorization: Bearer <Google access token>
 * Verifies the token with Google, then cancels Stripe subs for THAT email only.
 * Nobody can cancel another account without that account's Google sign-in.
 */
async function handleCancel(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ ok: false, error: 'missing_stripe_key' }, 500);
  }
  if (!env.LUAX_SUBS) {
    return json({ ok: false, error: 'missing_kv' }, 500);
  }

  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return json({ ok: false, error: 'not_signed_in' }, 401);
  }

  const identity = await verifyGoogleAccessToken(token, env);
  if (!identity || !identity.email) {
    return json({ ok: false, error: 'invalid_google_token' }, 401);
  }
  const email = String(identity.email).trim().toLowerCase();

  const customerId = await findStripeCustomerIdByEmail(email, env);
  if (!customerId) {
    // Clear local Pro flag anyway
    await putSub(env, email, {
      active: false,
      activeUntil: null,
      trial: false,
      status: 'canceled',
      lastEvent: 'app_cancel_no_customer',
    });
    return json({ ok: true, email, canceled: 0, note: 'no_stripe_customer' });
  }

  const subs = await listActiveSubscriptions(customerId, env);
  let scheduled = 0;
  let activeUntil = null;
  let trial = false;
  const errors = [];

  for (const sub of subs) {
    // Keep access until period end — do not delete the sub immediately
    const body = new URLSearchParams({ cancel_at_period_end: 'true' });
    const res = await fetch('https://api.stripe.com/v1/subscriptions/' + sub.id, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (res.ok) {
      scheduled++;
      const updated = await res.json().catch(() => null);
      const end =
        (updated && updated.current_period_end) ||
        (updated && updated.trial_end) ||
        sub.current_period_end ||
        sub.trial_end ||
        null;
      if (end) {
        const iso = new Date(end * 1000).toISOString();
        if (!activeUntil || iso > activeUntil) activeUntil = iso;
      }
      if ((updated && updated.status === 'trialing') || sub.status === 'trialing') trial = true;
    } else {
      const t = await res.text().catch(() => '');
      errors.push({ id: sub.id, status: res.status, body: t.slice(0, 200) });
    }
  }

  if (scheduled === 0 && !subs.length) {
    // Nothing in Stripe — clear Pro
    await putSub(env, email, {
      active: false,
      activeUntil: null,
      trial: false,
      status: 'canceled',
      cancelAtPeriodEnd: false,
      lastEvent: 'app_cancel_no_sub',
    });
    return json({ ok: true, email, scheduled: 0, note: 'no_active_subscription' });
  }

  // Stay Pro until period ends; webhook will set active:false when Stripe ends it
  await putSub(env, email, {
    active: true,
    activeUntil: activeUntil,
    trial: trial,
    status: trial ? 'trialing' : 'active',
    cancelAtPeriodEnd: true,
    lastEvent: 'app_cancel_at_period_end',
  });

  return json({
    ok: true,
    email,
    scheduled,
    activeUntil,
    cancelAtPeriodEnd: true,
    errors: errors.length ? errors : undefined,
  });
}

/**
 * Validate Google access token and bind it to THIS app's OAuth client.
 * Rejects tokens minted for other apps even if they include an email.
 * Set secret GOOGLE_CLIENT_ID to override the default (same as index.html).
 */
async function verifyGoogleAccessToken(accessToken, env) {
  try {
    const res = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken)
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || !data.email) return null;

    const expected =
      (env && env.GOOGLE_CLIENT_ID) ||
      '996784289780-lrl7mub599dn6eti14h3nvfre2ov6027.apps.googleusercontent.com';

    // Access tokens: azp = client that requested the token; aud may be the same
    // or a Google API scope audience. Accept if azp or aud matches our client.
    const azp = data.azp ? String(data.azp) : '';
    const aud = data.aud ? String(data.aud) : '';
    const audList = aud.split(' ').filter(Boolean);
    const ok =
      azp === expected ||
      aud === expected ||
      audList.indexOf(expected) !== -1;
    if (!ok) return null;

    return { email: data.email, sub: data.sub || null };
  } catch (_) {
    return null;
  }
}

async function findStripeCustomerIdByEmail(email, env) {
  try {
    const res = await fetch(
      'https://api.stripe.com/v1/customers?email=' + encodeURIComponent(email) + '&limit=5',
      { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } }
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const list = (data && data.data) || [];
    if (!list.length) return null;
    return list[0].id || null;
  } catch (_) {
    return null;
  }
}

async function listActiveSubscriptions(customerId, env) {
  try {
    const res = await fetch(
      'https://api.stripe.com/v1/subscriptions?customer=' +
        encodeURIComponent(customerId) +
        '&status=all&limit=20',
      { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } }
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const list = (data && data.data) || [];
    return list.filter(
      (s) => s && (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due')
    );
  } catch (_) {
    return [];
  }
}


const CREDIT_WEEKLY_FREE = 25;
const CREDIT_WEEKLY_PRO = 250;

function weekIdUTC(date) {
  const base = date instanceof Date ? date : new Date();
  const tmp = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    (((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7
  );
  return tmp.getUTCFullYear() + '-W' + week;
}

async function isEmailPro(env, email) {
  if (!env.LUAX_SUBS || !email) return false;
  const raw = await env.LUAX_SUBS.get('sub:' + email);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!data || !data.active) return false;
    if (data.activeUntil) {
      const end = Date.parse(data.activeUntil);
      if (!isNaN(end) && Date.now() > end) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function readCredits(env, email) {
  const wid = weekIdUTC();
  const key = 'credits:' + email;
  let used = 0;
  let week = wid;
  const raw = await env.LUAX_SUBS.get(key);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (data && data.week === wid) {
        used = Math.max(0, Number(data.used) || 0);
        week = data.week;
      }
    } catch (_) {}
  }
  const pro = await isEmailPro(env, email);
  const weekly = pro ? CREDIT_WEEKLY_PRO : CREDIT_WEEKLY_FREE;
  return {
    week,
    used,
    weekly,
    left: Math.max(0, weekly - used),
    pro,
  };
}

async function writeCredits(env, email, week, used) {
  await env.LUAX_SUBS.put(
    'credits:' + email,
    JSON.stringify({
      week,
      used: Math.max(0, used),
      updatedAt: new Date().toISOString(),
    })
  );
}

async function requireGoogleEmail(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { error: 'not_signed_in', status: 401 };
  const identity = await verifyGoogleAccessToken(token, env);
  if (!identity || !identity.email) return { error: 'invalid_google_token', status: 401 };
  return { email: String(identity.email).trim().toLowerCase() };
}

/** GET /credits — Authorization: Bearer Google token */
async function handleCreditsGet(request, env) {
  if (!env.LUAX_SUBS) return json({ ok: false, error: 'missing_kv' }, 500);
  const id = await requireGoogleEmail(request, env);
  if (id.error) return json({ ok: false, error: id.error }, id.status);
  const st = await readCredits(env, id.email);
  return json({ ok: true, email: id.email, ...st });
}

/**
 * POST /credits/consume
 * Authorization: Bearer Google token
 * Body: { "cost": number }
 * Server is source of truth for used; can only increase within the week.
 */
async function handleCreditsConsume(request, env) {
  if (!env.LUAX_SUBS) return json({ ok: false, error: 'missing_kv' }, 500);
  const id = await requireGoogleEmail(request, env);
  if (id.error) return json({ ok: false, error: id.error }, id.status);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }
  const cost = Math.floor(Number(body.cost) || 0);
  if (cost < 0 || cost > 1000) {
    return json({ ok: false, error: 'bad_cost' }, 400);
  }

  const st = await readCredits(env, id.email);
  if (cost > 0 && st.left < cost) {
    return json({
      ok: false,
      error: 'insufficient',
      email: id.email,
      week: st.week,
      used: st.used,
      weekly: st.weekly,
      left: st.left,
      pro: st.pro,
    }, 402);
  }

  const used = st.used + Math.max(0, cost);
  await writeCredits(env, id.email, st.week, used);
  return json({
    ok: true,
    email: id.email,
    week: st.week,
    used,
    weekly: st.weekly,
    left: Math.max(0, st.weekly - used),
    pro: st.pro,
  });
}

async function handleHealth(env) {
  return json({
    ok: true,
    hasKv: !!(env && env.LUAX_SUBS),
    hasWebhookSecret: !!(env && env.STRIPE_WEBHOOK_SECRET),
    hasStripeKey: !!(env && env.STRIPE_SECRET_KEY),
    hasStatusKey: !!(env && env.STATUS_SHARED_SECRET),
    hasGoogleClientId: !!(env && env.GOOGLE_CLIENT_ID),
    hasPriceId: !!(env && env.STRIPE_PRICE_ID),
  });
}

/**
 * GET /status
 * Requires Google access token for THIS app (Authorization: Bearer …).
 * Returns Pro state only for the signed-in email — cannot probe other accounts.
 * Optional ?email= must match the token email if provided.
 */
async function handleStatus(request, env, url) {
  if (!env.LUAX_SUBS) {
    return json({ active: false, reason: 'no_kv_binding' }, 500);
  }

  const id = await requireGoogleEmail(request, env);
  if (id.error) {
    return json({ active: false, reason: id.error }, id.status);
  }
  const email = id.email;

  const q = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (q && q !== email) {
    return json({ active: false, reason: 'email_mismatch' }, 403);
  }

  const raw = await env.LUAX_SUBS.get('sub:' + email);
  if (!raw) return json({ active: false, reason: 'not_found', email });

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return json({ active: false, reason: 'bad_kv', email });
  }
  return json({
    active: !!data.active,
    activeUntil: data.activeUntil || null,
    trial: !!data.trial,
    trialUsed: !!data.trialUsed || !!data.trial,
    status: data.status || (data.trial ? 'trialing' : data.active ? 'active' : 'inactive'),
    cancelAtPeriodEnd: !!data.cancelAtPeriodEnd,
    email,
  });
}

async function handleWebhook(request, env) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Missing STRIPE_WEBHOOK_SECRET', { status: 500 });
  }
  if (!env.LUAX_SUBS) {
    return new Response('Missing LUAX_SUBS KV binding', { status: 500 });
  }

  const valid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Invalid signature', { status: 400 });

  let event;
  try {
    event = JSON.parse(body);
  } catch (_) {
    return new Response('Bad payload', { status: 400 });
  }

  const obj = event.data && event.data.object;
  if (!obj) {
    await rememberLast(env, { type: event.type || 'unknown', ok: true, note: 'no_object' });
    return json({ received: true });
  }

  let email = null;
  let active = null;
  let activeUntil = null;
  let trial = false;
  let status = null;
  let cancelAtPeriodEnd = false;
  let cardGuardBlocked = false;

  if (event.type === 'checkout.session.completed') {
    // Prefer LuaX signed-in Google email (client_reference_id)
    const fromApp = obj.client_reference_id;
    const fromStripe =
      (obj.customer_details && obj.customer_details.email) ||
      obj.customer_email ||
      (obj.metadata && (obj.metadata.email || obj.metadata.user_email)) ||
      null;
    if (looksLikeEmail(fromApp)) {
      email = fromApp;
    } else if (looksLikeEmail(fromStripe)) {
      email = fromStripe;
    } else if (obj.customer) {
      email = await lookupCustomerEmail(obj.customer, env);
    }

    active = true;
    // Resolve subscription for trial + period end when Checkout created one
    if (obj.subscription && env.STRIPE_SECRET_KEY) {
      const sub = await lookupSubscription(obj.subscription, env);
      if (sub) {
        status = sub.status || null;
        trial = sub.status === 'trialing' || !!sub.trial_end;
        if (sub.current_period_end) {
          activeUntil = new Date(sub.current_period_end * 1000).toISOString();
        } else if (sub.trial_end) {
          activeUntil = new Date(sub.trial_end * 1000).toISOString();
        }
      }

      // One trial per physical card, regardless of email/Google account.
      // If this card already burned a trial elsewhere, decline this one —
      // cancel immediately (no charge, since a trial owes $0).
      if (trial && looksLikeEmail(email)) {
        const guard = await applyTrialCardGuard(obj.subscription, email, env);
        if (guard.blocked) {
          trial = guard.trial;
          status = guard.status;
          activeUntil = guard.activeUntil;
          active = false;
        }
        cardGuardBlocked = guard.blocked;
      }
    }
    if (!status) status = trial ? 'trialing' : 'active';
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    status = obj.status || null;
    trial = obj.status === 'trialing';
    active = obj.status === 'active' || obj.status === 'trialing';
    cancelAtPeriodEnd = !!obj.cancel_at_period_end;
    if (event.type === 'customer.subscription.deleted' || obj.status === 'canceled') {
      active = false;
      trial = false;
      status = 'canceled';
      cancelAtPeriodEnd = false;
    }
    if (obj.current_period_end) {
      activeUntil = new Date(obj.current_period_end * 1000).toISOString();
    } else if (obj.trial_end) {
      activeUntil = new Date(obj.trial_end * 1000).toISOString();
      trial = true;
    }
    email =
      obj.customer_email ||
      (obj.metadata && (obj.metadata.email || obj.metadata.user_email)) ||
      null;
    if (!email && obj.customer) {
      email = await lookupCustomerEmail(obj.customer, env);
    }
  } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
    active = true;
    // €0 invoice often means trial — mark trial if amount is 0
    const amountPaid = typeof obj.amount_paid === 'number' ? obj.amount_paid : null;
    trial = amountPaid === 0;
    status = trial ? 'trialing' : 'active';
    email =
      obj.customer_email ||
      (obj.customer_details && obj.customer_details.email) ||
      null;
    if (!email && obj.customer) {
      email = await lookupCustomerEmail(obj.customer, env);
    }
    if (obj.lines && obj.lines.data && obj.lines.data[0] && obj.lines.data[0].period) {
      const end = obj.lines.data[0].period.end;
      if (end) activeUntil = new Date(end * 1000).toISOString();
    }
    if (obj.subscription && env.STRIPE_SECRET_KEY) {
      const sub = await lookupSubscription(obj.subscription, env);
      if (sub) {
        status = sub.status || status;
        trial = sub.status === 'trialing' || trial;
        if (sub.current_period_end) {
          activeUntil = new Date(sub.current_period_end * 1000).toISOString();
        }
      }
    }
  }

  if (email && !looksLikeEmail(email)) {
    email = obj.customer ? await lookupCustomerEmail(obj.customer, env) : null;
    if (!looksLikeEmail(email)) {
      await rememberLast(env, {
        type: event.type,
        ok: false,
        note: 'email_not_valid',
      });
      return json({ received: true, saved: false, reason: 'email_not_valid' });
    }
  }

  if (email && active !== null) {
    email = String(email).trim().toLowerCase();
    await putSub(env, email, {
      active: !!active,
      activeUntil: activeUntil || null,
      trial: !!trial,
      trialUsed: cardGuardBlocked || undefined,
      status: status || (trial ? 'trialing' : active ? 'active' : 'inactive'),
      cancelAtPeriodEnd: typeof cancelAtPeriodEnd === 'boolean' ? cancelAtPeriodEnd : false,
      lastEvent: cardGuardBlocked ? 'trial_card_reused_blocked' : event.type,
    });
    await rememberLast(env, {
      type: event.type,
      ok: true,
      email,
      active: !!active,
      trial: !!trial,
      activeUntil: activeUntil || null,
      cardGuardBlocked: cardGuardBlocked,
    });
    return json({
      received: true,
      saved: true,
      email,
      active: !!active,
      trial: !!trial,
      activeUntil: activeUntil || null,
    });
  }

  await rememberLast(env, {
    type: event.type,
    ok: false,
    note: 'no_email_or_status',
    hasCustomer: !!obj.customer,
  });
  return json({ received: true, saved: false, reason: 'no_email_or_status' });
}

function looksLikeEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/**
 * POST /checkout
 * Authorization: Bearer <Google access token>
 * Creates a Stripe Checkout Session for LuaX Pro.
 * Free 5-day trial is included ONLY if this email has never had a trial
 * or prior subscription (checked in KV + Stripe customer history).
 *
 * Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID (price_xxx for €5/mo)
 * Optional: APP_URL (default https://crissticrs.github.io/luax)
 */
async function handleCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ ok: false, error: 'missing_stripe_key' }, 500);
  }
  if (!env.STRIPE_PRICE_ID) {
    return json({ ok: false, error: 'missing_price_id', hint: 'wrangler secret put STRIPE_PRICE_ID' }, 500);
  }

  const id = await requireGoogleEmail(request, env);
  if (id.error) {
    return json({ ok: false, error: id.error }, id.status || 401);
  }
  const email = id.email;

  const trialEligible = !(await customerHasUsedTrial(email, env));
  const appUrl = (env.APP_URL || 'https://crissticrs.github.io/luax').replace(/\/$/, '');

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('line_items[0][price]', env.STRIPE_PRICE_ID);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', appUrl + '/?pro=success&session_id={CHECKOUT_SESSION_ID}');
  params.set('cancel_url', appUrl + '/?pro=cancel');
  params.set('client_reference_id', email);
  params.set('metadata[email]', email);
  params.set('subscription_data[metadata][email]', email);
  params.set('allow_promotion_codes', 'true');

  // Reuse Stripe customer when possible (avoids duplicate customers)
  const existingCustomer = await findStripeCustomerIdByEmail(email, env);
  if (existingCustomer) {
    params.set('customer', existingCustomer);
  } else {
    params.set('customer_email', email);
  }

  if (trialEligible) {
    params.set('subscription_data[trial_period_days]', '5');
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      return json({
        ok: false,
        error: (data && data.error && data.error.message) || ('HTTP ' + res.status),
        trialEligible: trialEligible,
      }, 502);
    }
    return json({
      ok: true,
      url: data.url,
      sessionId: data.id || null,
      trialEligible: trialEligible,
      trialDays: trialEligible ? 5 : 0,
    });
  } catch (e) {
    return json({ ok: false, error: 'checkout_network', detail: String(e && e.message || e) }, 502);
  }
}

/** True if this email already used a trial or ever had a Stripe subscription. */
async function customerHasUsedTrial(email, env) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return true;

  // 1) Our KV flag (set on first trial via webhook)
  try {
    if (env.LUAX_SUBS) {
      const raw = await env.LUAX_SUBS.get('sub:' + email);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && (data.trialUsed || data.trial)) return true;
      }
    }
  } catch (_) {}

  // 2) Stripe customer history — any prior subscription = no second trial
  if (!env.STRIPE_SECRET_KEY) return false;
  try {
    const customerId = await findStripeCustomerIdByEmail(email, env);
    if (!customerId) return false;
    const res = await fetch(
      'https://api.stripe.com/v1/subscriptions?customer=' +
        encodeURIComponent(customerId) +
        '&status=all&limit=20',
      { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } }
    );
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    const list = (data && data.data) || [];
    if (!list.length) return false;
    // Any previous sub (trialing, active, canceled, unpaid, …) blocks a new trial
    return true;
  } catch (_) {
    return false;
  }
}

async function putSub(env, email, fields) {
  email = String(email).trim().toLowerCase();
  if (!looksLikeEmail(email) || !env.LUAX_SUBS) return;
  let prev = {};
  try {
    const raw = await env.LUAX_SUBS.get('sub:' + email);
    if (raw) prev = JSON.parse(raw) || {};
  } catch (_) { prev = {}; }
  const trialUsed = !!(prev.trialUsed || fields.trialUsed || fields.trial);
  await env.LUAX_SUBS.put(
    'sub:' + email,
    JSON.stringify({
      active: !!fields.active,
      activeUntil: fields.activeUntil || null,
      trial: !!fields.trial,
      trialUsed: trialUsed,
      status: fields.status || null,
      cancelAtPeriodEnd: !!fields.cancelAtPeriodEnd,
      updatedAt: new Date().toISOString(),
      lastEvent: fields.lastEvent || null,
    })
  );
}

async function rememberLast(env, info) {
  try {
    if (!env.LUAX_SUBS) return;
    await env.LUAX_SUBS.put(
      'debug:last_webhook',
      JSON.stringify({ ...info, at: new Date().toISOString() })
    );
  } catch (_) {}
}

async function lookupCustomerEmail(customerId, env) {
  if (!customerId || !env.STRIPE_SECRET_KEY) return null;
  try {
    const res = await fetch('https://api.stripe.com/v1/customers/' + customerId, {
      headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY },
    });
    if (!res.ok) return null;
    const cust = await res.json().catch(() => null);
    return (cust && cust.email) || null;
  } catch (_) {
    return null;
  }
}

async function lookupSubscription(subscriptionId, env) {
  if (!subscriptionId || !env.STRIPE_SECRET_KEY) return null;
  try {
    const res = await fetch('https://api.stripe.com/v1/subscriptions/' + subscriptionId, {
      headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY },
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (_) {
    return null;
  }
}

/**
 * One free trial per physical card — not per email/Google account.
 *
 * Stripe gives every payment method a stable "fingerprint" that identifies the
 * physical card across customers, even across totally unrelated Stripe
 * Customer objects. We key a KV record off that fingerprint (trialcard:<fp>)
 * the first time a card is used for a trial. If the *same* card shows up on
 * a *new* trialing subscription (i.e. a different Google account signed up
 * again), we cancel that trial immediately — a trialing subscription has $0
 * due, so cancelling it bills nothing and no money moves. The person simply
 * doesn't get Pro on the second account; their card is never charged.
 *
 * Cards that pay immediately (no trial) are also recorded, so a card can't
 * be "saved up" on a paid account and then used for a trial on a fresh one.
 *
 * Returns { trial, status, activeUntil, blocked }. Only apply the returned
 * trial/status/activeUntil over the caller's values when blocked === true.
 */
async function applyTrialCardGuard(subscriptionId, email, env) {
  const result = { trial: null, status: null, activeUntil: null, blocked: false };
  if (!subscriptionId || !env.STRIPE_SECRET_KEY || !env.LUAX_SUBS) return result;

  let sub;
  try {
    const res = await fetch(
      'https://api.stripe.com/v1/subscriptions/' +
        subscriptionId +
        '?expand[]=default_payment_method&expand[]=customer.invoice_settings.default_payment_method',
      { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } }
    );
    if (!res.ok) return result;
    sub = await res.json().catch(() => null);
  } catch (_) {
    return result;
  }
  if (!sub) return result;

  const pm =
    (sub.default_payment_method && typeof sub.default_payment_method === 'object' && sub.default_payment_method) ||
    (sub.customer &&
      typeof sub.customer === 'object' &&
      sub.customer.invoice_settings &&
      sub.customer.invoice_settings.default_payment_method) ||
    null;
  const fingerprint = pm && pm.card && pm.card.fingerprint ? pm.card.fingerprint : null;
  if (!fingerprint) return result; // can't identify the card — fail open, don't block a real user

  const key = 'trialcard:' + fingerprint;
  let already = null;
  try {
    already = await env.LUAX_SUBS.get(key);
  } catch (_) {}

  if (sub.status === 'trialing') {
    if (already) {
      // Do NOT charge the card — cancelling during a trial generates no
      // invoice, so nothing is billed. We simply decline the second trial.
      const canceled = await cancelSubscriptionNoCharge(subscriptionId, env);
      if (canceled) {
        result.trial = false;
        result.status = 'canceled';
        result.activeUntil = null;
        result.blocked = true;
      }
      // If the cancel call itself failed, fail open — leave the trial alone
      // rather than claim it's canceled when Stripe still has it trialing.
      return result;
    }
    // First time this card has been seen — it's now "spent" on this trial.
    try {
      await env.LUAX_SUBS.put(key, JSON.stringify({ email, usedAt: new Date().toISOString() }));
    } catch (_) {}
    return result;
  }

  // Not trialing (already paid) — still record the card so it can't be
  // reused for a *fresh* trial on a different account later.
  if (!already) {
    try {
      await env.LUAX_SUBS.put(key, JSON.stringify({ email, usedAt: new Date().toISOString() }));
    } catch (_) {}
  }
  return result;
}

/**
 * Cancels a still-trialing subscription immediately, with no charge.
 * A subscription in "trialing" status has $0 due — Stripe's cancel endpoint
 * does not generate an invoice or bill the card in this state, it just ends
 * the subscription. This is how we decline a reused-card trial without ever
 * touching the person's money.
 */
async function cancelSubscriptionNoCharge(subscriptionId, env) {
  try {
    const res = await fetch('https://api.stripe.com/v1/subscriptions/' + subscriptionId, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY },
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (_) {
    return null;
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const items = sigHeader.split(',').map((p) => p.trim());
  let timestamp = null;
  const v1s = [];
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq < 0) continue;
    const k = item.slice(0, eq);
    const v = item.slice(eq + 1);
    if (k === 't') timestamp = v;
    if (k === 'v1') v1s.push(v);
  }
  if (!timestamp || !v1s.length) return false;

  const signedPayload = timestamp + '.' + payload;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret.trim()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload)
  );
  const expected = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  for (const signature of v1s) {
    if (expected.length !== signature.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}

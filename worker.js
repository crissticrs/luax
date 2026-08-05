/**
 * LuaX Stripe verification worker (Cloudflare Workers + KV)
 *
 * POST /webhook  — Stripe events → KV sub:<email>
 * GET  /status?email= — { active, activeUntil }
 * GET  /health   — quick config check (no secrets leaked)
 *
 * Webhook URL:  https://luax-stripe.lua-x.workers.dev/webhook
 * Status URL:   https://luax-stripe.lua-x.workers.dev/status
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
          'Access-Control-Allow-Headers': 'Content-Type, X-LuaX-Key',
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
    return new Response('Not found', { status: 404 });
  },
};

async function handleHealth(env) {
  return json({
    ok: true,
    hasKv: !!(env && env.LUAX_SUBS),
    hasWebhookSecret: !!(env && env.STRIPE_WEBHOOK_SECRET),
    hasStripeKey: !!(env && env.STRIPE_SECRET_KEY),
    hasStatusKey: !!(env && env.STATUS_SHARED_SECRET),
  });
}

async function handleStatus(request, env, url) {
  if (env.STATUS_SHARED_SECRET) {
    const key = request.headers.get('X-LuaX-Key') || '';
    if (key !== env.STATUS_SHARED_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  if (!env.LUAX_SUBS) {
    return json({ active: false, reason: 'no_kv_binding' });
  }

  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json({ active: false, reason: 'no_email' });

  const raw = await env.LUAX_SUBS.get('sub:' + email);
  if (!raw) return json({ active: false, reason: 'not_found' });

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return json({ active: false, reason: 'bad_kv' });
  }
  return json({
    active: !!data.active,
    activeUntil: data.activeUntil || null,
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

  if (event.type === 'checkout.session.completed') {
    // Payment Link / Checkout — prefer explicit emails, then client_reference_id
    // (LuaX sets client_reference_id to the signed-in Google email)
    email =
      (obj.customer_details && obj.customer_details.email) ||
      obj.customer_email ||
      obj.client_reference_id ||
      (obj.metadata && (obj.metadata.email || obj.metadata.user_email)) ||
      null;
    active = true;
    if (obj.customer && !looksLikeEmail(email)) {
      email = (await lookupCustomerEmail(obj.customer, env)) || email;
    }
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    active = obj.status === 'active' || obj.status === 'trialing';
    if (event.type === 'customer.subscription.deleted') active = false;
    if (obj.current_period_end) {
      activeUntil = new Date(obj.current_period_end * 1000).toISOString();
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
  }

  if (email && !looksLikeEmail(email)) {
    // client_reference_id might not be an email — don't write garbage keys
    if (!(await lookupCustomerEmail(obj.customer, env))) {
      await rememberLast(env, {
        type: event.type,
        ok: false,
        note: 'email_not_valid',
        raw: String(email).slice(0, 80),
      });
      return json({ received: true, saved: false, reason: 'email_not_valid' });
    }
    email = await lookupCustomerEmail(obj.customer, env);
  }

  if (email && active !== null) {
    email = String(email).trim().toLowerCase();
    await env.LUAX_SUBS.put(
      'sub:' + email,
      JSON.stringify({
        active: !!active,
        activeUntil: activeUntil || null,
        updatedAt: new Date().toISOString(),
        lastEvent: event.type,
      })
    );
    await rememberLast(env, {
      type: event.type,
      ok: true,
      email,
      active: !!active,
    });
    return json({ received: true, saved: true, email, active: !!active });
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

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/** Stripe-compatible HMAC check; accepts any v1 signature in the header. */
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

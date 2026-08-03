/**
 * LuaX Stripe verification worker (Cloudflare Workers + KV)
 *
 * Closes the gap where Pro/credits were decided entirely by the browser.
 * Stripe is the source of truth; this worker just mirrors "is this email
 * an active subscriber right now" into a KV store that the app can check.
 *
 * Two endpoints:
 *
 *   POST /webhook
 *     Stripe calls this on subscription events. We verify the Stripe
 *     signature (so nobody can POST fake "I'm subscribed" events), then
 *     write { active, activeUntil } into KV keyed by customer email.
 *
 *   GET /status?email=...
 *     The LuaX client calls this (see STRIPE_STATUS_ENDPOINT in index.html).
 *     Reads from KV only — never calls the Stripe API live, so it's fast
 *     and can't be rate-limited or slowed down by Stripe.
 *
 * Deploy (one-time):
 *   1. npm install -g wrangler
 *   2. wrangler kv:namespace create LUAX_SUBS
 *      -> copy the returned "id" into wrangler.toml
 *   3. wrangler secret put STRIPE_WEBHOOK_SECRET
 *        (Stripe Dashboard -> Developers -> Webhooks -> your endpoint -> Signing secret)
 *   4. wrangler secret put STRIPE_SECRET_KEY
 *        (Stripe Dashboard -> Developers -> API keys -> Secret key.
 *         Only used as a fallback to look up a customer's email by ID —
 *         never exposed to the browser.)
 *   5. wrangler deploy
 *   6. Stripe Dashboard -> Developers -> Webhooks -> Add endpoint
 *        URL: https://<your-worker-subdomain>.workers.dev/webhook
 *        Events to send: checkout.session.completed,
 *                         customer.subscription.created,
 *                         customer.subscription.updated,
 *                         customer.subscription.deleted
 *   7. In index.html, set:
 *        const STRIPE_STATUS_ENDPOINT = 'https://<your-worker-subdomain>.workers.dev/status';
 *
 * Optional hardening: /status is unauthenticated by default and keyed only
 * by email, so someone could probe whether a given email is a subscriber.
 * That's a minor privacy leak, not a way to get free Pro (only a real
 * Stripe webhook event ever writes `active: true` into KV) — but if you
 * want to close it too:
 *   8. wrangler secret put STATUS_SHARED_SECRET   (any random string)
 *      Then set the same value as STRIPE_STATUS_KEY in index.html.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight (needed when client sends X-LuaX-Key)
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
    if (request.method === 'POST' && url.pathname === '/webhook') {
      return handleWebhook(request, env);
    }
    return new Response('Not found', { status: 404 });
  },
};

async function handleStatus(request, env, url) {
  // Optional hardening: if STATUS_SHARED_SECRET is set as a Worker secret,
  // require the client to send it as X-LuaX-Key. Prevents random callers
  // from probing which emails are subscribers. Set the same value in
  // index.html's STRIPE_STATUS_KEY.
  if (env.STATUS_SHARED_SECRET) {
    const key = request.headers.get('X-LuaX-Key') || '';
    if (key !== env.STATUS_SHARED_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json({ active: false, reason: 'no_email' });

  const raw = await env.LUAX_SUBS.get('sub:' + email);
  if (!raw) return json({ active: false });

  let data;
  try { data = JSON.parse(raw); } catch (_) { return json({ active: false }); }
  return json({ active: !!data.active, activeUntil: data.activeUntil || null });
}

async function handleWebhook(request, env) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();

  const valid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Invalid signature', { status: 400 });

  let event;
  try { event = JSON.parse(body); } catch (_) { return new Response('Bad payload', { status: 400 }); }
  const obj = event.data && event.data.object;
  if (!obj) return json({ received: true });

  let email = null;
  let active = null;
  let activeUntil = null;

  if (event.type === 'checkout.session.completed') {
    email = (obj.customer_details && obj.customer_details.email) || obj.customer_email || null;
    active = true;
  } else if (event.type.startsWith('customer.subscription.')) {
    active = obj.status === 'active' || obj.status === 'trialing';
    if (obj.current_period_end) {
      activeUntil = new Date(obj.current_period_end * 1000).toISOString();
    }
    // Subscription objects don't always carry the email directly —
    // fall back to looking up the Customer.
    email = obj.customer_email || (obj.customer ? await lookupCustomerEmail(obj.customer, env) : null);
  }

  if (email && active !== null) {
    email = String(email).toLowerCase();
    await env.LUAX_SUBS.put('sub:' + email, JSON.stringify({ active, activeUntil }));
  }

  return json({ received: true });
}

async function lookupCustomerEmail(customerId, env) {
  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY },
  });
  if (!res.ok) return null;
  const cust = await res.json().catch(() => null);
  return (cust && cust.email) || null;
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: {
      'Content-Type': 'application/json',
      // Loosen this to your real domain once things are working, e.g.
      // 'Access-Control-Allow-Origin': 'https://yoursite.example'
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Verifies a Stripe webhook signature using only Web Crypto (no npm deps,
 * so this runs as-is on Workers). Mirrors what stripe-node's
 * constructEvent() does under the hood.
 */
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.split('=')).map(([k, v]) => [k, v])
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

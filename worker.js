/**
 * LuaX Stripe verification worker (Cloudflare Workers + KV)
 *
 * POST /webhook  — Stripe events → KV sub:<email>
 * GET  /status?email= — { active, activeUntil, trial, trialUsed, status }
 * POST /checkout — create Checkout Session (5-day trial once per email)
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

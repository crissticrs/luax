// src/error-tracking.js — lightweight production error visibility
//
// Setup (optional Sentry free tier):
//   1. Create a browser project at https://sentry.io
//   2. Either set in index.html BEFORE other scripts:
//        <script>window.LUAX_SENTRY_DSN = "https://...@o....ingest.sentry.io/...";</script>
//      or set LUAX_SENTRY_DSN below.
// Without a DSN, errors are still stored in sessionStorage and logged to the console.
//
// Usage in catch blocks:
//   catch (e) { reportError(e, 'cloud-sync.upload'); }

(function (global) {
    'use strict';

    // Optional: paste your Sentry DSN here (or set window.LUAX_SENTRY_DSN earlier)
    var HARDCODED_DSN = '';

    var DSN = (global.LUAX_SENTRY_DSN || HARDCODED_DSN || '').trim();
    var LOCAL_KEY = 'luax_error_log';
    var MAX_LOCAL = 40;
    var SENTRY_CDN = 'https://browser.sentry-cdn.com/8.47.0/bundle.min.js';

    function pushLocal(entry) {
        try {
            var arr = [];
            try { arr = JSON.parse(sessionStorage.getItem(LOCAL_KEY) || '[]'); } catch (_) { arr = []; }
            if (!Array.isArray(arr)) arr = [];
            arr.push(entry);
            while (arr.length > MAX_LOCAL) arr.shift();
            sessionStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
        } catch (_) {}
    }

    function toError(err) {
        if (err instanceof Error) return err;
        try {
            var e = new Error(typeof err === 'string' ? err : (err && err.message) || String(err));
            if (err && err.stack) e.stack = err.stack;
            return e;
        } catch (_) {
            return new Error(String(err));
        }
    }

    function reportError(err, context) {
        var error = toError(err);
        var ctx = context;
        if (typeof context === 'string') ctx = { where: context };
        var entry = {
            t: Date.now(),
            message: error.message || String(err),
            stack: error.stack || '',
            context: ctx || null,
            href: (typeof location !== 'undefined' && location.href) || ''
        };
        pushLocal(entry);
        try {
            if (ctx) console.error('[LuaX]', ctx, error);
            else console.error('[LuaX]', error);
        } catch (_) {}

        if (global.Sentry && typeof global.Sentry.captureException === 'function') {
            try {
                global.Sentry.withScope(function (scope) {
                    if (ctx) {
                        Object.keys(ctx).forEach(function (k) {
                            try { scope.setExtra(k, ctx[k]); } catch (_) {}
                        });
                    }
                    global.Sentry.captureException(error);
                });
            } catch (_) {}
        }
        return entry;
    }

    function reportMessage(msg, level, extra) {
        level = level || 'error';
        var entry = {
            t: Date.now(),
            message: String(msg),
            stack: '',
            context: extra || null,
            level: level,
            href: (typeof location !== 'undefined' && location.href) || ''
        };
        pushLocal(entry);
        try { console[level] ? console[level]('[LuaX]', msg, extra || '') : console.log('[LuaX]', msg); } catch (_) {}
        if (global.Sentry && typeof global.Sentry.captureMessage === 'function') {
            try {
                global.Sentry.withScope(function (scope) {
                    if (extra) scope.setExtras(typeof extra === 'object' ? extra : { detail: extra });
                    global.Sentry.captureMessage(String(msg), level);
                });
            } catch (_) {}
        }
    }

    function getLuaxErrorLog() {
        try {
            var arr = JSON.parse(sessionStorage.getItem(LOCAL_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function clearLuaxErrorLog() {
        try { sessionStorage.removeItem(LOCAL_KEY); } catch (_) {}
    }

    if (!global.__luaxErrorHandlers) {
        global.__luaxErrorHandlers = true;
        global.addEventListener('error', function (e) {
            try {
                reportError(e.error || new Error(e.message || 'Script error'), {
                    where: 'window.error',
                    filename: e.filename,
                    lineno: e.lineno,
                    colno: e.colno
                });
            } catch (_) {}
        });
        global.addEventListener('unhandledrejection', function (e) {
            try {
                var reason = e.reason;
                reportError(reason instanceof Error ? reason : new Error(String(reason)), {
                    where: 'unhandledrejection'
                });
            } catch (_) {}
        });
    }

    function initSentry() {
        if (!DSN || global.Sentry) return;
        var s = document.createElement('script');
        s.src = SENTRY_CDN;
        s.crossOrigin = 'anonymous';
        s.onload = function () {
            if (!global.Sentry || !global.Sentry.init) return;
            try {
                global.Sentry.init({
                    dsn: DSN,
                    environment: (typeof location !== 'undefined' && location.hostname) || 'unknown',
                    release: global.LUAX_RELEASE || undefined,
                    tracesSampleRate: 0,
                    sampleRate: 1.0,
                    ignoreErrors: [
                        'ResizeObserver loop',
                        'Non-Error promise rejection captured'
                    ],
                    beforeSend: function (event) {
                        try {
                            var text = JSON.stringify(event);
                            if (/ya29\.|Bearer [A-Za-z0-9\-._~+\/]+=*/.test(text)) {
                                if (event.request) delete event.request.cookies;
                            }
                        } catch (_) {}
                        return event;
                    }
                });
                try { global.Sentry.setTag('app', 'luax'); } catch (_) {}
            } catch (err) {
                try { console.warn('[LuaX] Sentry init failed', err); } catch (_) {}
            }
        };
        s.onerror = function () {
            try { console.warn('[LuaX] Failed to load Sentry SDK'); } catch (_) {}
        };
        (document.head || document.documentElement).appendChild(s);
    }

    initSentry();

    global.reportError = reportError;
    global.reportMessage = reportMessage;
    global.getLuaxErrorLog = getLuaxErrorLog;
    global.clearLuaxErrorLog = clearLuaxErrorLog;
})(typeof window !== 'undefined' ? window : this);

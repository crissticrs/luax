// src/error-tracking.js — lightweight production error visibility
//
// Sentry: uses the official loader (no separate DSN string needed).
// Local fallback: always logs to console + sessionStorage even if Sentry fails.
//
// Usage in catch blocks:
//   catch (e) { reportError(e, 'cloud-sync.upload'); }
//
// Debug: getLuaxErrorLog()  /  clearLuaxErrorLog()

(function (global) {
    'use strict';

    // Your Sentry browser loader (from Sentry project settings)
    var SENTRY_LOADER =
        (global.LUAX_SENTRY_LOADER || '').trim() ||
        'https://js-de.sentry-cdn.com/c7bd3e8628715121a64a79e5a8c183dc.min.js';

    var LOCAL_KEY = 'luax_error_log';
    var MAX_LOCAL = 40;

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
        try {
            if (console[level]) console[level]('[LuaX]', msg, extra || '');
            else console.log('[LuaX]', msg);
        } catch (_) {}
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
        if (!SENTRY_LOADER) return;
        if (document.querySelector('script[data-luax-sentry]')) return;
        var s = document.createElement('script');
        s.src = SENTRY_LOADER;
        s.crossOrigin = 'anonymous';
        s.setAttribute('data-luax-sentry', '1');
        s.onload = function () {
            try {
                if (global.Sentry && global.Sentry.setTag) {
                    global.Sentry.setTag('app', 'luax');
                }
                if (global.Sentry && global.Sentry.setContext) {
                    global.Sentry.setContext('luax', {
                        host: (typeof location !== 'undefined' && location.hostname) || ''
                    });
                }
            } catch (_) {}
        };
        s.onerror = function () {
            try { console.warn('[LuaX] Failed to load Sentry loader'); } catch (_) {}
        };
        (document.head || document.documentElement).appendChild(s);
    }

    initSentry();

    global.reportError = reportError;
    global.reportMessage = reportMessage;
    global.getLuaxErrorLog = getLuaxErrorLog;
    global.clearLuaxErrorLog = clearLuaxErrorLog;
})(typeof window !== 'undefined' ? window : this);

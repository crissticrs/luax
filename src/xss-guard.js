// src/xss-guard.js — harden esc() for stored-XSS (names in onclick attrs)
(function () {
    function escSafe(s) {
        return String(s == null ? '' : s)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    function sanitizeNameSafe(name, fallback) {
        var s = String(name == null ? '' : name).trim();
        s = s.replace(/[\u0000-\u001f\u007f]/g, '');
        if (s.length > 80) s = s.slice(0, 80);
        if (!s) s = fallback || 'Untitled';
        return s;
    }
    function lock() {
        window.esc = escSafe;
        window.sanitizeName = sanitizeNameSafe;
        try {
            Object.defineProperty(window, 'esc', { value: escSafe, writable: true, configurable: true });
        } catch (_) {}
        try {
            Object.defineProperty(window, 'sanitizeName', { value: sanitizeNameSafe, writable: true, configurable: true });
        } catch (_) {}
    }
    lock();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', lock);
    }
    setTimeout(lock, 0);
    setTimeout(lock, 100);
})();

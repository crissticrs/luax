// ============================================================
// XSS-safe helpers (names in onclick / HTML)
// ============================================================
/** Escape for single-quoted JS inside double-quoted HTML attributes. */
function esc(s) {
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

/** Sanitize project/file names from user input or imported JSON. */
function sanitizeName(name, fallback) {
    let s = String(name == null ? '' : name).trim();
    s = s.replace(/[\u0000-\u001f\u007f]/g, '');
    if (s.length > 80) s = s.slice(0, 80);
    if (!s) s = fallback || 'Untitled';
    return s;
}

if (typeof window !== 'undefined') {
    // Lock esc so a later weak definition in index.html cannot reintroduce XSS
    try {
        Object.defineProperty(window, 'esc', {
            value: esc,
            writable: false,
            configurable: false
        });
    } catch (_) { window.esc = esc; }
    try {
        Object.defineProperty(window, 'sanitizeName', {
            value: sanitizeName,
            writable: false,
            configurable: false
        });
    } catch (_) { window.sanitizeName = sanitizeName; }
    document.addEventListener('DOMContentLoaded', function () {
        try {
            Object.defineProperty(window, 'esc', { value: esc, writable: false, configurable: false });
        } catch (_) { try { window.esc = esc; } catch (__) {} }
    });
}

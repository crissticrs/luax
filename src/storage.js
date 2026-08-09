// ============================================================
// XSS-safe helpers (names in onclick / HTML)
// ============================================================
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
function sanitizeName(name, fallback) {
    let s = String(name == null ? '' : name).trim();
    s = s.replace(/[\u0000-\u001f\u007f]/g, '');
    if (s.length > 80) s = s.slice(0, 80);
    if (!s) s = fallback || 'Untitled';
    return s;
}
(function () {
    try {
        Object.defineProperty(window, 'esc', { value: esc, writable: false, configurable: false });
    } catch (_) { window.esc = esc; }
    try {
        Object.defineProperty(window, 'sanitizeName', { value: sanitizeName, writable: false, configurable: false });
    } catch (_) { window.sanitizeName = sanitizeName; }
})();

// Load persistence module (same directory)
document.write('<script src="src/storage-core.js"><\/script>');

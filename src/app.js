// src/app.js — app shell: navigation, projects UI, themes, file list, boot
// Extracted from index.html so the page stays markup-only.
// Modal helpers (openModal / closeModal / confirmModal) live in src/modal.js.

// PLAY / RUN GAME — capture-phase so it always works, even if later code fails
document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-action="run-game"]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof window.startPlayMode === 'function') {
        try { window.startPlayMode(); }
        catch (err) { alert('PLAY error: ' + (err && err.message ? err.message : err)); }
    } else {
        alert('Game engine is still loading. Wait 1 second and try RUN GAME again.');
    }
}, true);


// ============================================================
// NAV
// ============================================================
function switchView(id) {
    if (!isAuthed() && id !== 'login-view') {
        applyAuthGate();
        return;
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

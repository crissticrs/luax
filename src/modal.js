// Load error tracking (Sentry + local log) as early as possible
(function loadErrorTracking() {
    if (window.reportError) return;
    try {
        var s = document.createElement('script');
        s.src = 'src/error-tracking.js';
        s.async = false;
        (document.head || document.documentElement).appendChild(s);
    } catch (_) {}
})();

// ============================================================
// MODAL + TOAST SYSTEM (themed — replaces native alert/confirm)
// ============================================================
// Exposes: openModal, closeModal, confirmModal, lxAlert, lxConfirm, lxToast
// window.alert is overridden to use the themed dialog.

// Inject toast/dialog CSS (no need to edit main.css / index.html)
(function injectLxDialogCss() {
    if (document.getElementById('lx-dialog-css')) return;
    const s = document.createElement('style');
    s.id = 'lx-dialog-css';
    s.textContent = '.lx-dialog-msg {\n    margin: 0;\n    font-size: 0.95rem;\n    line-height: 1.45;\n    color: var(--text-color, #e8e6f0);\n    white-space: pre-wrap;\n    word-break: break-word;\n}\n#lx-toast-host {\n    position: fixed;\n    left: 50%;\n    bottom: calc(16px + env(safe-area-inset-bottom, 0px));\n    transform: translateX(-50%);\n    z-index: 100000;\n    display: flex;\n    flex-direction: column-reverse;\n    align-items: center;\n    gap: 8px;\n    pointer-events: none;\n    width: min(92vw, 420px);\n}\n.lx-toast {\n    pointer-events: none;\n    opacity: 0;\n    transform: translateY(12px) scale(0.98);\n    transition: opacity 0.22s ease, transform 0.22s ease;\n    padding: 12px 16px;\n    border-radius: 12px;\n    font-size: 0.9rem;\n    line-height: 1.35;\n    text-align: center;\n    color: #fff;\n    background: color-mix(in srgb, var(--panel-color, #1a1625) 92%, #000);\n    border: 1px solid color-mix(in srgb, var(--accent-color, #8b5cf6) 35%, transparent);\n    box-shadow: 0 8px 28px rgba(0,0,0,0.45);\n    max-width: 100%;\n}\n.lx-toast.show { opacity: 1; transform: translateY(0) scale(1); }\n.lx-toast-ok { border-color: color-mix(in srgb, #22c55e 50%, transparent); }\n.lx-toast-error { border-color: color-mix(in srgb, #f43f5e 55%, transparent); }\n.lx-toast-info { border-color: color-mix(in srgb, var(--accent-color, #8b5cf6) 45%, transparent); }\n';
    (document.head || document.documentElement).appendChild(s);
})();

let modalCallback = null;
let modalCancelCallback = null;
let modalMode = 'form';

function openModal(title, bodyHtml, confirmLabel, callback) {
    modalMode = 'form';
    modalCancelCallback = null;
    const cancelBtn = document.getElementById('modal-cancel');
    if (cancelBtn) {
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'Cancel';
    }
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-confirm').textContent = confirmLabel || 'OK';
    document.getElementById('custom-modal').style.display = 'flex';
    modalCallback = callback;
    const input = document.querySelector('#modal-body input');
    if (input) setTimeout(() => input.focus(), 40);
}

function closeModal() {
    document.getElementById('custom-modal').style.display = 'none';
    const cancelCb = modalCancelCallback;
    modalCallback = null;
    modalCancelCallback = null;
    modalMode = 'form';
    if (cancelCb) {
        try { cancelCb(); } catch (_) {}
    }
}

function confirmModal() {
    const cb = modalCallback;
    modalCallback = null;
    modalCancelCallback = null;
    document.getElementById('custom-modal').style.display = 'none';
    modalMode = 'form';
    if (cb) {
        try { cb(); } catch (_) {}
    }
}

function _lxEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

function lxAlert(message, title) {
    title = title || 'LuaX';
    return new Promise((resolve) => {
        modalMode = 'alert';
        modalCancelCallback = null;
        const cancelBtn = document.getElementById('modal-cancel');
        if (cancelBtn) cancelBtn.style.display = 'none';
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML =
            '<p class="lx-dialog-msg">' + _lxEsc(message) + '</p>';
        document.getElementById('modal-confirm').textContent = 'OK';
        document.getElementById('custom-modal').style.display = 'flex';
        modalCallback = () => resolve();
    });
}

function lxConfirm(message, title) {
    title = title || 'Confirm';
    return new Promise((resolve) => {
        modalMode = 'confirm';
        const cancelBtn = document.getElementById('modal-cancel');
        if (cancelBtn) {
            cancelBtn.style.display = '';
            cancelBtn.textContent = 'Cancel';
        }
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML =
            '<p class="lx-dialog-msg">' + _lxEsc(message) + '</p>';
        document.getElementById('modal-confirm').textContent = 'OK';
        document.getElementById('custom-modal').style.display = 'flex';
        let settled = false;
        const done = (v) => {
            if (settled) return;
            settled = true;
            resolve(!!v);
        };
        modalCallback = () => done(true);
        modalCancelCallback = () => done(false);
    });
}

function lxToast(message, type, ms) {
    type = type || 'info';
    ms = ms == null ? 2800 : ms;
    let host = document.getElementById('lx-toast-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'lx-toast-host';
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'lx-toast lx-toast-' + type;
    el.textContent = String(message == null ? '' : message);
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 280);
    }, ms);
}

(function patchNativeDialogs() {
    const nativeAlert = window.alert.bind(window);
    window.alert = function (msg) {
        try {
            if (document.getElementById('custom-modal')) {
                lxAlert(msg);
                return;
            }
        } catch (_) {}
        nativeAlert(msg);
    };
    window._nativeAlert = nativeAlert;
})();

document.addEventListener('DOMContentLoaded', () => {
    const m = document.getElementById('custom-modal');
    if (!m) return;
    m.addEventListener('click', (e) => {
        if (e.target !== m) return;
        if (modalMode === 'alert') {
            confirmModal();
        } else {
            closeModal();
        }
    });
});

window.openModal = openModal;
window.closeModal = closeModal;
window.confirmModal = confirmModal;
window.lxAlert = lxAlert;
window.lxConfirm = lxConfirm;
window.lxToast = lxToast;

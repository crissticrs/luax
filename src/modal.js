// error-tracking.js and xss-guard.js are loaded as plain <script> tags near
// the top of index.html now (previously injected dynamically from here with
// no error handling — see index.html boot watchdog comment for why that
// pattern was removed).

// ============================================================
// MODAL + TOAST SYSTEM (themed — replaces native alert/confirm)
// ============================================================

(function injectLxDialogCss() {
    if (document.getElementById('lx-dialog-css')) return;
    const s = document.createElement('style');
    s.id = 'lx-dialog-css';
    s.textContent = '.lx-dialog-msg{margin:0;font-size:0.95rem;line-height:1.45;color:var(--text-color,#e8e6f0);white-space:pre-wrap;word-break:break-word}#lx-toast-host{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:100000;display:flex;flex-direction:column-reverse;align-items:center;gap:8px;pointer-events:none;width:min(92vw,420px)}.lx-toast{pointer-events:none;opacity:0;transform:translateY(12px) scale(0.98);transition:opacity .22s ease,transform .22s ease;padding:12px 16px;border-radius:12px;font-size:0.9rem;line-height:1.35;text-align:center;color:#fff;background:color-mix(in srgb,var(--panel-color,#1a1625) 92%,#000);border:1px solid color-mix(in srgb,var(--accent-color,#8b5cf6) 35%,transparent);box-shadow:0 8px 28px rgba(0,0,0,.45);max-width:100%}.lx-toast.show{opacity:1;transform:translateY(0) scale(1)}.lx-toast-ok{border-color:color-mix(in srgb,#22c55e 50%,transparent)}.lx-toast-error{border-color:color-mix(in srgb,#f43f5e 55%,transparent)}.lx-toast-info{border-color:color-mix(in srgb,var(--accent-color,#8b5cf6) 45%,transparent)}';
    (document.head || document.documentElement).appendChild(s);
})();

var modalCallback = null;
var modalCancelCallback = null;
var modalMode = 'form';

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
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
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

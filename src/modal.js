// ============================================================
// MODAL + TOAST SYSTEM (themed — replaces native alert/confirm)
// ============================================================
// Exposes: openModal, closeModal, confirmModal, lxAlert, lxConfirm, lxToast
// window.alert is overridden to use the themed dialog.

let modalCallback = null;
let modalCancelCallback = null;
let modalMode = 'form'; // 'form' | 'alert' | 'confirm'

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

/** Escape text for safe HTML body */
function _lxEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

/**
 * Themed alert dialog. Returns a Promise that resolves when the user taps OK.
 * Also assigned to window.alert (fire-and-forget; does not block the JS thread).
 */
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

/**
 * Themed confirm dialog. Resolves true (OK) or false (Cancel).
 */
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

/** Non-blocking toast (success / error / info). Auto-hides. */
function lxToast(message, type, ms) {
    type = type || 'info'; // info | ok | error
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

// Override native alert → themed (keeps every alert(...) call working)
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
    // Keep a path to native if ever needed
    window._nativeAlert = nativeAlert;
})();

// Backdrop click = cancel for confirm/alert
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

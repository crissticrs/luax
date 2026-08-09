// ============================================================
// MODAL SYSTEM
// ============================================================
// Extracted from index.html — small, self-contained.
// Exposes openModal / closeModal / confirmModal on window
// so existing onclick handlers and callers keep working.

let modalCallback = null;

function openModal(title, bodyHtml, confirmLabel, callback) {
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
    modalCallback = null;
}

function confirmModal() {
    if (modalCallback) modalCallback();
    closeModal();
}

// Keep global for HTML onclick + rest of app
window.openModal = openModal;
window.closeModal = closeModal;
window.confirmModal = confirmModal;

// Early global bindings (Safari: free vars from other files need window.*)
window.renderProjects = window.renderProjects || function () {};

// NOTE: full file restored in follow-up if this is incomplete
function renderProjects() {
    try {
        const list = document.getElementById('projects-list');
        if (!list) return;
        list.innerHTML = '<div class="empty-state">Loading…</div>';
    } catch (_) {}
}

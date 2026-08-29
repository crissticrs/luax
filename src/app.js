// Boot complete marker.
// All app scripts are now loaded as plain, ordered <script> tags in
// index.html (see comment there for history: this used to be a hand-rolled
// sequential script loader with no timeout/retry, which could hang the page
// indefinitely if a single request stalled). The head watchdog in
// index.html shows a retry banner if boot doesn't reach this point within
// BOOT_TIMEOUT_MS.
(function () {
    try {
        if (typeof window.__luaxMarkBooted === 'function') window.__luaxMarkBooted();
    } catch (_) {}
})();

// scene-editor-layout.js — ONLY change Paint/Sprites labels to emoji
(function () {
  function polish() {
    var view = document.getElementById('scene-editor-view');
    if (!view) return;
    view.querySelectorAll('.scn-tab').forEach(function (tab) {
      var k = tab.getAttribute('data-scn-tab');
      if (k === 'paint') {
        tab.textContent = '\uD83D\uDD8C'; // paintbrush
        tab.title = 'Paint';
      } else if (k === 'sprites') {
        tab.textContent = '\uD83D\uDC7E'; // alien monster
        tab.title = 'Sprites';
      }
    });
  }

  function hook() {
    try {
      var o = window.openSceneEditor;
      if (typeof o === 'function' && !o._luaxEmojiTabs) {
        window.openSceneEditor = function () {
          var r = o.apply(this, arguments);
          setTimeout(polish, 30);
          setTimeout(polish, 120);
          return r;
        };
        window.openSceneEditor._luaxEmojiTabs = true;
      }
    } catch (_) {}
    polish();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(hook, 200); });
  } else {
    setTimeout(hook, 200);
  }
})();

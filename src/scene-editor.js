// scene-editor.js — load gzip pack parts then run
(function () {
  function boot(code) {
    var s = document.createElement("script");
    s.textContent = code;
    document.head.appendChild(s);
  }
  function fail() {
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/gh/crissticrs/luax@10a459e0d2a84335344304e83837e3befcccd5f3/src/scene-editor.js";
    document.head.appendChild(s);
  }
  try {
    if (typeof DecompressionStream === "undefined") return fail();
    Promise.all([
      fetch("src/scene-editor-pack-a.txt").then(function (r) { return r.text(); }),
      fetch("src/scene-editor-pack-b.txt").then(function (r) { return r.text(); })
    ]).then(function (parts) {
      var bin = atob(parts[0] + parts[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var ds = new DecompressionStream("gzip");
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Response(stream).text();
    }).then(boot).catch(function (e) {
      console.error(e);
      fail();
    });
  } catch (e) {
    console.error(e);
    fail();
  }
})();

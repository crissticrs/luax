// scene-editor.js — hex+gzip packed editor (NxN brush size)
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
  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  try {
    if (typeof DecompressionStream === "undefined") return fail();
    Promise.all([0,1,2,3].map(function (i) {
      return fetch("src/scene-editor-hex" + i + ".txt").then(function (r) { return r.text(); });
    })).then(function (parts) {
      var bytes = hexToBytes(parts.join("").replace(/\s/g, ""));
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

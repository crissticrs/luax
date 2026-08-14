// scene-editor.js — single gzip b64 pack v33
(function () {
  function boot(code) {
    var s = document.createElement("script");
    s.textContent = code;
    document.head.appendChild(s);
  }
  function fail(e) { console.error("scene-editor", e); }
  try {
    if (typeof DecompressionStream === "undefined") return fail("no DecompressionStream");
    fetch("src/scene-editor-full.b64?v=33").then(function (r) {
      if (!r.ok) throw new Error("pack " + r.status);
      return r.text();
    }).then(function (b64) {
      var bin = atob(b64.replace(/\s/g, ""));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var ds = new DecompressionStream("gzip");
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Response(stream).text();
    }).then(boot).catch(fail);
  } catch (e) { fail(e); }
})();

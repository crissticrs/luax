// scene-editor.js — loads full.b64 from pack-a + pack-b (v33)
(function () {
  function boot(code) {
    var s = document.createElement("script");
    s.textContent = code;
    document.head.appendChild(s);
  }
  function fail(e) { console.error("scene-editor", e); }
  try {
    if (typeof DecompressionStream === "undefined") return fail("no DecompressionStream");
    Promise.all([
      fetch("src/scene-editor-pack-a.txt?v=33").then(function (r) { if (!r.ok) throw new Error("a"); return r.text(); }),
      fetch("src/scene-editor-pack-b.txt?v=33").then(function (r) { if (!r.ok) throw new Error("b"); return r.text(); })
    ]).then(function (parts) {
      var bin = atob(parts.join("").replace(/\s/g, ""));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var ds = new DecompressionStream("gzip");
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Response(stream).text();
    }).then(boot).catch(fail);
  } catch (e) { fail(e); }
})();

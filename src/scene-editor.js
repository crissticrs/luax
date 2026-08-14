// scene-editor.js gzip b64 parts v34
(function(){
  function fail(e){console.error("scene-editor",e);}
  if(typeof DecompressionStream==="undefined"){return fail("no DecompressionStream");}
  Promise.all([0,1,2].map(function(i){
    return fetch("src/scn_b64_"+i+".txt?v=34").then(function(r){if(!r.ok)throw new Error(i);return r.text();});
  })).then(function(parts){
    var b64=parts.join("");
    var bin=atob(b64);
    var bytes=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"));
  }).then(function(stream){
    return new Response(stream).text();
  }).then(function(code){
    var s=document.createElement("script");
    s.textContent=code;
    document.head.appendChild(s);
  }).catch(fail);
})();

// The in-browser VIEWER for the one-page OE brief — PURE, client-safe, tested.
//
// The Glance "⇩ OE brief" used to download a file the operator then had to
// find and open (2026-10-05 walkthrough: "should pop up in browser view with
// export HTML/PDF"). The viewer is the same zero-JS brief with a toolbar on
// top: Download HTML (the CLEAN file, still zero scripts), Print / save as
// PDF (the browser's own dialog), Close. The toolbar does not print.
//
// The clean HTML is carried inside the viewer as a JSON string literal so
// the downloaded file is byte-for-byte the pure render — the viewer's own
// script never touches the document it was asked to save.

export function renderOeBriefViewerHtml(cleanHtml: string, filename: string): string {
  // `</` inside the literal would end the script element early.
  const literal = JSON.stringify(cleanHtml).replace(/<\//g, "<\\/");
  const name = JSON.stringify(filename).replace(/<\//g, "<\\/");
  const bar = `<div class="oe-viewer-bar" role="toolbar" aria-label="OE brief actions">
<span class="oe-viewer-t">OE brief · viewer</span>
<button type="button" id="oe-dl">⇩ Download HTML (no scripts)</button>
<button type="button" id="oe-pr">⎙ Print / save as PDF</button>
<button type="button" id="oe-cl">✕ Close</button>
<span class="oe-viewer-n">The downloaded file is self-contained: zero JavaScript, zero external resources — opens on a locked-down machine from a share drive.</span>
</div>`;
  const style = `<style id="oe-viewer-style">
.oe-viewer-bar{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 14px;background:#0f172a;border-bottom:1px solid #334155;font:12px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#cbd5e1}
.oe-viewer-t{font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6ee7b7;font-size:10px}
.oe-viewer-bar button{cursor:pointer;border:1px solid #475569;background:#1e293b;color:#e2e8f0;border-radius:6px;padding:4px 10px;font:inherit}
.oe-viewer-bar button:hover{border-color:#34d399;color:#6ee7b7}
.oe-viewer-n{color:#64748b;font-size:10.5px;flex-basis:100%}
@media print{.oe-viewer-bar{display:none !important}}
</style>`;
  const script = `<script>
(function(){
  var CLEAN=${literal};
  var NAME=${name};
  var dl=document.getElementById("oe-dl"),pr=document.getElementById("oe-pr"),cl=document.getElementById("oe-cl");
  if(dl)dl.addEventListener("click",function(){
    var b=new Blob([CLEAN],{type:"text/html"});var u=URL.createObjectURL(b);
    var a=document.createElement("a");a.href=u;a.download=NAME;document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(u)},2000);
  });
  if(pr)pr.addEventListener("click",function(){window.print()});
  if(cl)cl.addEventListener("click",function(){window.close()});
})();
</script>`;
  const withBar = cleanHtml.includes("<body>") ? cleanHtml.replace("<body>", `<body>${bar}`) : `${bar}${cleanHtml}`;
  return withBar.includes("</head>")
    ? withBar.replace("</head>", `${style}</head>`).replace("</body>", `${script}</body>`)
    : `${style}${withBar}${script}`;
}

import { describe, it, expect } from "vitest";
import { renderOeBriefViewerHtml } from "../lib/oeBriefViewer";

const clean = `<!doctype html><html><head><title>OE Brief</title></head><body><div class="page"><p>Iraq &lt;strikes&gt;</p></div></body></html>`;

describe("renderOeBriefViewerHtml", () => {
  const html = renderOeBriefViewerHtml(clean, "OE-BRIEF-20261005-1200Z.html");

  it("adds a toolbar with download, print and close, hidden in print", () => {
    expect(html).toMatch(/id="oe-dl"/);
    expect(html).toMatch(/id="oe-pr"/);
    expect(html).toMatch(/id="oe-cl"/);
    expect(html).toMatch(/@media print\{\.oe-viewer-bar\{display:none/);
  });

  it("carries the CLEAN brief untouched as the file to download", () => {
    const m = html.match(/var CLEAN=("(?:[^"\\]|\\.)*");/);
    expect(m).not.toBeNull();
    const roundTrip = JSON.parse(m![1].replace(/<\\\//g, "</"));
    expect(roundTrip).toBe(clean);
    expect(roundTrip).not.toMatch(/<script/i);
    expect(html).toMatch(/OE-BRIEF-20261005-1200Z\.html/);
  });

  it("never lets a '</script>' inside the brief end the viewer script early", () => {
    const tricky = clean.replace("<p>", "<p>&lt;/script&gt; </script> ");
    const out = renderOeBriefViewerHtml(tricky, "x.html");
    const scriptBody = out.slice(out.indexOf("var CLEAN="), out.lastIndexOf("</script>"));
    expect(scriptBody).not.toMatch(/<\/script>/);
  });
});

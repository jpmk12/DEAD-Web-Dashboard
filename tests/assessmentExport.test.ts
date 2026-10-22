import { describe, it, expect } from "vitest";
import { assessmentTitle, assessmentFileName, assessmentMarkdown, renderAssessmentHtml, stripBoardNote, type AssessmentRecord } from "../lib/assessmentExport";

const REC: AssessmentRecord = {
  question: "How likely is conflict with Iran?",
  answer: "**BLUF:** WATCH, not warning.\n\n## Evidence\n- Hormuz: 1 reported act (UKMTO)\n- Posture: amber, chronic\n\n_Answered from the board (the question looked like a warning question). Turn ◉ Board off in the header to chat freely._",
  atISO: "2026-10-22T14:05:00.000Z",
  source: "board",
  model: "claude-sonnet-4-6",
  surfaces: [
    { label: "OSINT › Commands › I&W · CENTCOM · Iran" },
    { label: "Glance › 7-day demand horizon", unavailable: true },
  ],
  unavailable: ["Economy › actor board"],
  unplaced: ["Ruritania"],
  preparedBy: "ops@example.mil",
};

describe("assessment export — names", () => {
  it("titles by the question and the day, truncating a long question on a word", () => {
    expect(assessmentTitle(REC)).toBe("Assessment — How likely is conflict with Iran? (2026-10-22)");
    const long = { ...REC, question: "What indicators are you seeing that show Russia positioning for war against the Baltic states this winter and what would change the call" };
    const t = assessmentTitle(long);
    expect(t.length).toBeLessThan(110);
    expect(t).toMatch(/…\s\(2026-10-22\)$/);
    expect(t).toContain("positioning for war against…"); // cut on a word boundary, never mid-word
  });
  it("a chat answer with no question falls back to the answer's first line", () => {
    expect(assessmentTitle({ ...REC, question: "", answer: "# Jordan posture\nRed since Tuesday." })).toBe("Assessment — Jordan posture (2026-10-22)");
  });
  it("file names are slugged and dated", () => {
    expect(assessmentFileName(REC, "html")).toBe("assessment-how-likely-is-conflict-with-iran-2026-10-22.html");
    expect(assessmentFileName({ ...REC, question: "???" }, "md")).toBe("assessment-bluf-watch-not-warning-2026-10-22.md");
  });
});

describe("assessment export — the record", () => {
  it("strips the client's board note and keeps the answer", () => {
    expect(stripBoardNote(REC.answer)).not.toMatch(/Answered from the board/);
    expect(stripBoardNote(REC.answer)).toMatch(/Posture: amber, chronic$/);
    expect(stripBoardNote("plain")).toBe("plain");
  });
  it("the markdown carries provenance, the answer, the surfaces, UNAVAILABLE stated, and what was not placed", () => {
    const md = assessmentMarkdown(REC);
    expect(md.startsWith("# Assessment — How likely is conflict with Iran? (2026-10-22)\n")).toBe(true);
    expect(md).toContain("**Asked:** How likely is conflict with Iran?");
    expect(md).toContain("**Answered:** 2026-10-22 14:05Z · from the board (dashboard evidence pack) · claude-sonnet-4-6");
    expect(md).toContain("**Prepared by:** ops@example.mil");
    expect(md).toContain("> Snapshot — not live.");
    expect(md).toContain("## Assessment\n\n**BLUF:** WATCH, not warning.");
    expect(md).not.toContain("Answered from the board (the question");
    expect(md).toContain("- OSINT › Commands › I&W · CENTCOM · Iran");
    expect(md).toContain("- Economy › actor board — UNAVAILABLE, not evidence of calm");
    expect(md).toContain("- Glance › 7-day demand horizon — UNAVAILABLE");
    expect(md).toContain("The board could not place: Ruritania.");
  });
  it("a chat answer says so and omits the empty provenance sections", () => {
    const md = assessmentMarkdown({ question: "Why is Jordan red?", answer: "Because of X.", atISO: "2026-10-22T09:00:00Z", source: "assistant" });
    expect(md).toContain("the assistant (chat context)");
    expect(md).not.toContain("## Surfaces read");
    expect(md).not.toContain("## Unavailable");
    expect(md).not.toContain("## Not placed");
  });
});

describe("assessment export — the standalone HTML", () => {
  it("is self-contained: no script, no external src/href, stamped NOT LIVE", () => {
    const html = renderAssessmentHtml(REC);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)=["']https?:/i);
    expect(html).toContain("SNAPSHOT AS OF 2026-10-22 14:05Z — NOT LIVE");
    expect(html).toContain("<title>Assessment — How likely is conflict with Iran? (2026-10-22)</title>");
    expect(html).toContain("<strong>BLUF:</strong> WATCH, not warning.");
    expect(html).toContain("<li>Hormuz: 1 reported act (UKMTO)</li>");
    expect(html).toContain("Economy › actor board — UNAVAILABLE, not evidence of calm");
    expect(html).toContain("<li>Ruritania</li>");
    expect(html).not.toContain("Answered from the board (the question");
  });
  it("escapes markup in the question and the answer — model output over external content never injects", () => {
    const html = renderAssessmentHtml({
      ...REC,
      question: `<img src=x onerror=alert(1)> "quoted"`,
      answer: "Line <script>alert(1)</script> and [x](javascript:alert(1))",
      surfaces: [{ label: "<b>bold</b>" }],
      preparedBy: "<i>me</i>",
    });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toMatch(/href="javascript:/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot;");
    expect(html).toContain("<li>&lt;b&gt;bold&lt;/b&gt;</li>");
    expect(html).toContain("&lt;i&gt;me&lt;/i&gt;");
  });
});

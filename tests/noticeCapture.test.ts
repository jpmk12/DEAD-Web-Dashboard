import { describe, it, expect } from "vitest";
import { parseNoticesCapture } from "../lib/noticeCapture";
import { readOfficialNotice, actorForNoticeHost } from "../lib/economicWarfare";

const capture = (items: unknown[], host = "www.mofcom.gov.cn") => JSON.stringify({
  format: "dead-notices", version: 1, capturedAt: "2026-09-29T08:00:00Z",
  source: { kind: "mofcom", label: "MOFCOM", host }, items,
});

describe("parseNoticesCapture", () => {
  it("accepts https permalinks on the claimed host, keeps a real body, never guesses a date", () => {
    const r = parseNoticesCapture(capture([
      { url: "https://www.mofcom.gov.cn/zwgk/gkzcfb/art/2026/art_1.html", title: "商务部 海关总署公告2026年第12号 关于对镓、锗相关物项实施出口管制的公告", date: "2026-09-15", body: "x".repeat(50) },
      { url: "https://www.mofcom.gov.cn/zwgk/gkzcfb/art/2026/art_2.html", title: "关于举办贸易博览会的通知", date: "15/09/2026" },
      { url: "https://evil.example.com/notice.html", title: "Announcement on export control of gallium", date: "2026-09-15" },
      { url: "https://www.mofcom.gov.cn/zwgk/gkzcfb/art/2026/art_1.html", title: "dup" },
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notices.length).toBe(2);
    expect(r.skipped).toBe(2);
    expect(r.notices[0].publishedOn).toBe("2026-09-15");
    expect(r.notices[0].body?.length).toBe(50);
    expect(r.notices[1].publishedOn).toBeNull();
    expect(r.notices[1].body).toBeNull();
    expect(r.host).toBe("www.mofcom.gov.cn");
  });
  it("refuses an unsupported host, a wrong format, and an empty list", () => {
    expect(parseNoticesCapture(capture([{ url: "https://x/1", title: "abcdefg" }], "ministry.example.org")).ok).toBe(false);
    expect(parseNoticesCapture(JSON.stringify({ format: "dead-events", items: [] })).ok).toBe(false);
    expect(parseNoticesCapture(capture([])).ok).toBe(false);
    expect(parseNoticesCapture("nope").ok).toBe(false);
  });
});

describe("readOfficialNotice — a notice is an act by the issuer", () => {
  it("reads Chinese export-control, mineral and entity-list notices", () => {
    expect(readOfficialNotice("关于对镓、锗相关物项实施出口管制的公告")).toMatchObject({ instrument: "trade", cls: "mineral / component control", modality: "act" });
    expect(readOfficialNotice("关于将有关外国实体列入不可靠实体清单的公告")).toMatchObject({ instrument: "sanctions", cls: "unreliable entity list", modality: "act" });
    expect(readOfficialNotice("关于对部分两用物项实施出口管制的公告")).toMatchObject({ instrument: "sanctions", cls: "export control" });
    expect(readOfficialNotice("关于对原产于美国的进口丙酸反倾销调查的公告")).toMatchObject({ instrument: "trade", cls: "tariff" });
  });
  it("a draft for comment is intent, not an act; a trade-fair notice earns nothing", () => {
    const d = readOfficialNotice("《两用物项出口管制条例（征求意见稿）》公开征求意见");
    expect(d?.modality).toBe("threat");
    expect(d!.weight).toBeLessThan(readOfficialNotice("两用物项出口管制公告")!.weight);
    expect(readOfficialNotice("关于举办贸易博览会的通知")).toBeNull();
  });
  it("English mirror notices go through the phrase grammar but keep the notice's own modality", () => {
    const r = readOfficialNotice("Announcement on export controls on gallium and germanium related items");
    expect(r?.instrument).toBe("trade");
    expect(r?.modality).toBe("act");
  });
  it("credits MOFCOM hosts to China and nothing else to anyone", () => {
    expect(actorForNoticeHost("www.mofcom.gov.cn")?.actorId).toBe("china");
    expect(actorForNoticeHost("english.mofcom.gov.cn")?.actorId).toBe("china");
    expect(actorForNoticeHost("mofcom.gov.cn.evil.com")).toBeNull();
    expect(actorForNoticeHost("federalregister.gov")).toBeNull();
  });
});

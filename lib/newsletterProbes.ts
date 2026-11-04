// The wider searches the newsletter check page (`/api/newsletters?diag=1`)
// runs when a rule's own 7-day query finds nothing — PURE, tested
// (tests/newsletterProbes.test.ts). Sender rules have always had two (30 days,
// then the bare word); subject rules had none, so "AMC News Clips finds
// nothing" could not say whether the subject changed, the mail stopped, or
// the phrase lives in the body (2026-11-04).

export interface Probe { key: "last30d" | "looseWords" | "anywhere" | "bareWord"; query: string; reads: string }

const clean = (v: string) => v.trim().replace(/[\r\n]+/g, " ").replace(/"/g, "");

/** Subject rule probes, in order: the exact phrase over 30 days; every
 *  significant word of it in the subject, any order (catches "AMC Daily News
 *  Clips" and "Clips — AMC News"); the phrase ANYWHERE in the message over 30
 *  days (a newsletter whose subject changed but whose masthead did not). */
export function subjectProbes(value: string): Probe[] {
  const v = clean(value);
  if (!v) return [];
  const words = [...new Set(v.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}&-]/gu, "")).filter((w) => w.length >= 3))];
  const out: Probe[] = [{ key: "last30d", query: `subject:"${v}" newer_than:30d`, reads: "the exact subject phrase, 30 days" }];
  if (words.length >= 2) out.push({ key: "looseWords", query: `subject:(${words.join(" ")}) newer_than:30d`, reads: "every word in the subject, any order, 30 days" });
  out.push({ key: "anywhere", query: `"${v}" newer_than:30d`, reads: "the phrase anywhere in the message, 30 days" });
  return out;
}

/** Sender rule probes (as before): 30 days, then the bare name word. */
export function senderProbes(value: string): Probe[] {
  const v = value.trim().replace(/\s+/g, "");
  if (!v) return [];
  const out: Probe[] = [{ key: "last30d", query: `from:${v} newer_than:30d`, reads: "the sender, 30 days" }];
  const word = v.replace(/^.*@/, "").replace(/^www\./, "").split(".")[0];
  if (word.length >= 3) out.push({ key: "bareWord", query: `from:${word} newer_than:30d`, reads: "any sender containing the name, 30 days" });
  return out;
}

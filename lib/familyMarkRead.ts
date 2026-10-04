// Which family messages may be marked read after a digest — PURE, client-safe.
//
// The Family tab's promise is "we read this so you don't have to", and an
// unread badge on mail the board has already turned into a deadline is the
// duplicate attention the tab exists to remove. So, like the Newsletters
// route, a digest marks what it read as read — with three differences that
// are the whole point of this module:
//
//   1. Only after the model pass SUCCEEDED. The Newsletters route marks read
//      at fetch time, before summarising. Here a failed or disabled model call
//      marks NOTHING: the pane says the summary is unavailable, and the inbox
//      badge stays as the last safety net against the buried obligation the
//      tab was built to catch. The caller passes `ok`; this function never
//      infers success from an empty result.
//   2. Mail the board could not finish with stays UNREAD. A deadline the model
//      could not anchor to a date, an event with a relative phrase, and an
//      account-jeopardy hit (declined payment, final notice) all send the
//      user to the email itself — "open the email", not "add". Clearing the
//      badge on those would be a small lie. The caller names them in `keep`.
//   3. Opt-in on the roster (`markRead`, default on). It changes inbox state,
//      and un-reading mail in bulk is awkward, so it has a switch.
//
// The Gmail queries must keep ignoring read state (no `is:unread`): the
// silence watch, cadence learning and deadline persistence all re-read mail
// the app has already seen. Marking read is safe for them precisely because
// of that; adding the filter would break all three.

export interface MarkReadInput {
  /** Every message id the digest fetched AND put in front of the model. */
  read: string[];
  /** Ids whose finding needs the user's own eyes — left unread. */
  keep: Iterable<string>;
  /** True only when the model call returned and parsed. */
  ok: boolean;
  /** The roster switch (`FamilyProfile.markRead`). */
  enabled: boolean;
}

/** Message ids to mark read, deduplicated, in input order; `[]` whenever
 *  marking is off or the pass did not succeed. */
export function messagesToMarkRead(input: MarkReadInput): string[] {
  if (!input.enabled || !input.ok) return [];
  const keep = new Set(input.keep);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of input.read) {
    if (!id || keep.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

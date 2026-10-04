// Client-safe: the link that starts the secondary-Gmail OAuth hop.
//
// A NONCE per tap, on a clean path. The response is already no-store, but a
// browser that cached the OLD initiate redirect keyed by the old URL will
// replay it forever (mobile Safari did — Google answered the stale
// authorize URL with its bare "400 … malformed" page). A URL no browser has
// ever requested cannot be served from cache. `href` stays nonce-free for
// server rendering (a nonce in the markup would mismatch on hydration);
// `onClick` navigates to the nonced form, and a no-JS browser still works
// because the plain href reaches the same handler.

export const SECONDARY_START_PATH = "/api/auth/gmail-secondary/start";

export function secondaryStartHref(nonce: number = Date.now()): string {
  return `${SECONDARY_START_PATH}?n=${nonce.toString(36)}`;
}

/** Anchor props for an "Add second Gmail" link: plain href for SSR/no-JS,
 *  a nonced navigation on click. */
export function secondaryStartAnchorProps(): { href: string; onClick: (e: { preventDefault(): void }) => void } {
  return {
    href: SECONDARY_START_PATH,
    onClick: (e) => {
      e.preventDefault();
      window.location.assign(secondaryStartHref());
    },
  };
}

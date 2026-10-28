// Registered by background.js for the few seconds an X capture runs, ONLY for
// the capture target's URL, at document_start in the page's own world, so it
// is in place before X's code makes its first request.
//
// It keeps a COPY of the timeline responses X's own code already asked for
// (the GraphQL list / home / bookmarks / search / profile timelines). Nothing
// is sent to X, no request is changed, no credential is read — the page made
// these requests itself; this only remembers what came back. Why: Chrome
// pauses rendering in a tab that is not on screen, so the page only ever
// DRAWS a handful of posts, while each response already carries ~20.
// background.js reads window.__deadX after the scroll and drops it with the
// tab. Capped so it can never hold much.
(() => {
  if (window.__deadX) return;
  const TIMELINE = /\/i\/api\/graphql\/[^/?]+\/(ListLatestTweetsTimeline|ListTimeline|HomeTimeline|HomeLatestTimeline|Bookmarks|SearchTimeline|UserTweets|UserTweetsAndReplies|UserMedia|Likes|TweetDetail)\b/;
  const MAX_BYTES = 8 * 1024 * 1024;
  const store = (window.__deadX = { responses: [], urls: [], bytes: 0 });
  const keep = (url, text) => {
    try {
      if (!TIMELINE.test(String(url)) || typeof text !== "string" || !text) return;
      if (store.bytes + text.length > MAX_BYTES || store.responses.length >= 60) return;
      store.responses.push(text);
      store.urls.push(String(url).split("?")[0]);
      store.bytes += text.length;
    } catch (e) { /* never break the page */ }
  };

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        const input = args[0];
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (TIMELINE.test(url)) {
          p.then((r) => { try { r.clone().text().then((t) => keep(url, t), () => {}); } catch (e) { /* ignore */ } }, () => {});
        }
      } catch (e) { /* never break the page */ }
      return p;
    };
  }

  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const open = XHR.open, send = XHR.send;
    XHR.open = function (method, url, ...rest) { try { this.__deadUrl = String(url); } catch (e) { /* ignore */ } return open.call(this, method, url, ...rest); };
    XHR.send = function (...args) {
      try {
        if (this.__deadUrl && TIMELINE.test(this.__deadUrl)) {
          this.addEventListener("load", () => {
            try {
              if (this.responseType === "" || this.responseType === "text") keep(this.__deadUrl, this.responseText);
              else if (this.responseType === "json") keep(this.__deadUrl, JSON.stringify(this.response));
            } catch (e) { /* ignore */ }
          });
        }
      } catch (e) { /* never break the page */ }
      return send.apply(this, args);
    };
  }
})();

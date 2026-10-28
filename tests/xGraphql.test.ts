import { describe, it, expect } from "vitest";
// @ts-expect-error — plain JS module from the extension (no type declarations)
import { postsFromGraphql, mergeXPosts } from "../tools/x-auto-capture/xgraphql.js";

const user = (handle: string, name: string, nested = true) => ({
  __typename: "User",
  ...(nested ? { core: { screen_name: handle, name } } : { legacy: { screen_name: handle, name } }),
});

const tweet = (id: string, text: string, extra: Record<string, unknown> = {}, handle = "spotter1") => ({
  __typename: "Tweet",
  rest_id: id,
  core: { user_results: { result: user(handle, "Spotter One") } },
  legacy: {
    full_text: text,
    created_at: "Wed Oct 28 05:12:00 +0000 2026",
    reply_count: 3, retweet_count: 7, favorite_count: 21,
    entities: { urls: [], media: [] },
    ...(extra.legacy as object || {}),
  },
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "legacy")),
});

const timeline = (tweets: unknown[]) => JSON.stringify({
  data: { list: { tweets_timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: tweets.map((t, i) => ({
    entryId: `tweet-${i}`,
    content: { itemContent: { tweet_results: { result: t } } },
  })) }] } } } },
});

describe("postsFromGraphql", () => {
  it("reads every post in a list timeline response, with author, time and metrics", () => {
    const posts = postsFromGraphql([timeline([
      tweet("1850000000000000001", "6x KC-135 out of Mildenhall heading east"),
      tweet("1850000000000000002", "REACH flights into Al Udeid tonight", {}, "spotter2"),
    ])]);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      id: "1850000000000000001",
      url: "https://x.com/spotter1/status/1850000000000000001",
      handle: "spotter1",
      author: "Spotter One",
      time: "2026-10-28T05:12:00.000Z",
      metrics: { replies: 3, reposts: 7, likes: 21 },
    });
    expect(posts[1].handle).toBe("spotter2");
  });

  it("keeps a quoted post inside its parent, never as a second row", () => {
    const quoted = tweet("1850000000000000010", "C-17s staging at Ramstein", {}, "quotee");
    const posts = postsFromGraphql([timeline([
      tweet("1850000000000000011", "Worth watching", { quoted_status_result: { result: quoted } }),
    ])]);
    expect(posts).toHaveLength(1);
    expect(posts[0].quoted).toMatchObject({ handle: "quotee", text: "C-17s staging at Ramstein" });
  });

  it("reads a repost as the original post", () => {
    const original = tweet("1850000000000000020", "Tankers orbiting over Jordan", {}, "orig");
    const posts = postsFromGraphql([timeline([
      tweet("1850000000000000021", "RT @orig: Tankers orbiting…", { legacy: { retweeted_status_result: { result: original } } }, "reposter"),
    ])]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: "1850000000000000020", handle: "orig", text: "Tankers orbiting over Jordan" });
  });

  it("unwraps a visibility wrapper and the older legacy user block", () => {
    const inner = { ...tweet("1850000000000000030", "Wrapped post"), core: { user_results: { result: user("oldstyle", "Old Style", false) } } };
    const posts = postsFromGraphql([timeline([{ __typename: "TweetWithVisibilityResults", tweet: inner }])]);
    expect(posts[0]).toMatchObject({ id: "1850000000000000030", handle: "oldstyle" });
  });

  it("prefers a long post's full note, expands links and drops media links", () => {
    const t = tweet("1850000000000000040", "short… https://t.co/abc https://t.co/pic", {
      legacy: { entities: { urls: [{ url: "https://t.co/abc", expanded_url: "https://example.org/a" }], media: [{ url: "https://t.co/pic" }] } },
    });
    expect(postsFromGraphql([timeline([t])])[0].text).toBe("short… https://example.org/a");
    const long = tweet("1850000000000000041", "truncated", { note_tweet: { note_tweet_results: { result: { text: "The whole long post." } } } });
    expect(postsFromGraphql([timeline([long])])[0].text).toBe("The whole long post.");
  });

  it("dedupes across responses, skips junk bodies and honours the cap", () => {
    const a = timeline([tweet("1850000000000000050", "one"), tweet("1850000000000000051", "two")]);
    const b = timeline([tweet("1850000000000000051", "two"), tweet("1850000000000000052", "three")]);
    expect(postsFromGraphql(["not json", a, b])).toHaveLength(3);
    expect(postsFromGraphql([a, b], 2)).toHaveLength(2);
  });

  it("drops a post with no text", () => {
    expect(postsFromGraphql([timeline([tweet("1850000000000000060", "")])])).toHaveLength(0);
  });
});

describe("mergeXPosts", () => {
  it("keeps API posts first, fills a missing quote from the DOM, appends DOM-only posts", () => {
    const api = [{ id: "1", url: "u1", handle: "a", text: "api one" }];
    const dom = [
      { id: "1", url: "u1", handle: "a", text: "dom one", quoted: { author: "Q", handle: "q", text: "quoted" } },
      { id: "2", url: "u2", handle: "b", text: "dom two" },
    ];
    const merged = mergeXPosts(api, dom);
    expect(merged.map((p: { id: string }) => p.id)).toEqual(["1", "2"]);
    expect(merged[0].text).toBe("api one");
    expect(merged[0].quoted.text).toBe("quoted");
  });
});

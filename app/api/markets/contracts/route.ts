import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface ContractAward {
  id: string;
  title: string;       // first sentence-ish — vendor + amount + work type
  vendor: string | null;
  amountUsd: number | null;
  branch: string | null;  // ARMY / NAVY / AIR FORCE / etc.
  link: string;
  pubDate: string;
}

const TTL_MS = 60 * 60 * 1000; // DOD posts daily; once an hour is generous
let cached: { data: ContractAward[]; expires: number } | null = null;

const FEEDS = [
  "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=15",
  // Backup URLs in case the first format is later moved
  "https://www.defense.gov/News/Contracts/Contract/RSS.ashx",
];

// Defense.gov contract press releases are written in a specific format:
//   "{Vendor}, {City} {State}, has been awarded a {amount} {contract type}…"
// We extract vendor / amount / branch where possible; fall back to the
// raw title otherwise.
function parseContractTitle(rawTitle: string, description: string): Pick<ContractAward, "vendor" | "amountUsd" | "branch"> {
  const t = `${rawTitle} ${description}`.slice(0, 2000);

  // Vendor: usually before the first comma in the title.
  let vendor: string | null = null;
  const titleM = rawTitle.match(/^([A-Z][^,]{2,80}),/);
  if (titleM) vendor = titleM[1].trim();

  // Dollar amount: look for $XXX,XXX or $XXX million / billion patterns.
  let amountUsd: number | null = null;
  const dollar = t.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion)?/i);
  if (dollar) {
    let n = parseFloat(dollar[1].replace(/,/g, ""));
    if (dollar[2]?.toLowerCase() === "million") n *= 1e6;
    else if (dollar[2]?.toLowerCase() === "billion") n *= 1e9;
    if (Number.isFinite(n) && n > 0) amountUsd = n;
  }

  // Branch: look for the issuing-organization phrase.
  let branch: string | null = null;
  const branches = ["Army", "Navy", "Air Force", "Marine Corps", "Space Force", "Defense Logistics Agency", "Missile Defense Agency"];
  for (const b of branches) {
    const re = new RegExp(`(?:U\\.?S\\.?\\s+)?${b}\\b`, "i");
    if (re.test(t)) { branch = b.toUpperCase(); break; }
  }

  return { vendor, amountUsd, branch };
}

async function fetchFromFeed(url: string): Promise<ContractAward[]> {
  const res = await fetch(url, { headers: { "User-Agent": "DEAD-Dashboard" }, cache: "no-store" });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const xml = await res.text();

  // Minimal RSS parsing — items between <item> tags.
  const items: ContractAward[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  for (const m of xml.matchAll(itemRe)) {
    const block = m[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const description = extractTag(block, "description");
    const pubDate = extractTag(block, "pubDate");
    if (!title) continue;
    const parsed = parseContractTitle(title, description);
    items.push({
      id: link || `${title.slice(0, 60)}-${pubDate}`,
      title: title.slice(0, 400),
      link,
      pubDate,
      ...parsed,
    });
  }
  return items;
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (cached && cached.expires > Date.now()) {
    return NextResponse.json({ contracts: cached.data, cached: true });
  }

  // Try each feed URL until one returns items. Defense.gov has shuffled
  // their RSS endpoints in the past.
  for (const url of FEEDS) {
    try {
      const items = await fetchFromFeed(url);
      if (items.length > 0) {
        cached = { data: items, expires: Date.now() + TTL_MS };
        return NextResponse.json({ contracts: items });
      }
    } catch (err) {
      console.warn(`DOD contracts feed ${url} failed:`, err);
    }
  }
  return NextResponse.json({ contracts: [], error: "All DOD contracts feeds returned empty" });
}

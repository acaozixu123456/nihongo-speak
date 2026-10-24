import "server-only";

// The day's stories come from BBC News's public RSS feeds: business first (the TOEIC lives in offices,
// shops and travel), then the world and technology. Each story's own page gives the text the learner's
// article is written from (lib/claude.ts newsNotes), and the feed gives its picture.

const FEEDS = [
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", take: 2 },
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", take: 1 },
  { url: "https://feeds.bbci.co.uk/news/technology/rss.xml", take: 1 },
];
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// day: the day it came out in Tokyo (YYYY-MM-DD); rank: the order the stories are offered in on that day.
export type ListItem = { id: string; day: string; at: string; title: string; rank: number; link: string; description: string; image?: string };

const entities = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const tag = (xml: string, name: string) => entities(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? "").trim();

// Tokyo's date and time of an RSS pubDate.
function tokyo(pub: string) {
  const t = Date.parse(pub);
  const d = new Date((Number.isFinite(t) ? t : Date.now()) + 9 * 3600 * 1000).toISOString();
  return { day: d.slice(0, 10), at: `${d.slice(0, 10)} ${d.slice(11, 19)}` };
}

// .../news/articles/c0lz3xd1234o?at_medium=RSS → c0lz3xd1234o; /news/business-12345678 → business12345678.
const idOf = (link: string) =>
  (new URL(link).pathname.split("/").filter(Boolean).pop() ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 40).toLowerCase();

async function feed(url: string): Promise<Omit<ListItem, "rank">[]> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`BBC feed ${url}: HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const link = tag(item, "link").split("?")[0];
    // Videos, live pages and sport have no article text to learn from.
    if (!link || /\/(live|videos|av|sport|sounds|iplayer)\//.test(link)) return [];
    const id = idOf(link);
    if (!id) return [];
    const thumb = /<media:thumbnail[^>]*url="([^"]+)"/.exec(item)?.[1];
    return [
      {
        id,
        ...tokyo(tag(item, "pubDate")),
        title: tag(item, "title"),
        link,
        description: tag(item, "description"),
        // The feed's picture is 240px wide; the same picture is kept at other widths too.
        ...(thumb ? { image: thumb.replace(/\/ace\/(standard|ws)\/\d+\//, "/ace/standard/976/") } : {}),
      },
    ];
  });
}

// Newest day first; within a day, the feeds' order (business first).
export async function newsList(): Promise<ListItem[]> {
  const lists = await Promise.allSettled(FEEDS.map((f) => feed(f.url)));
  const seen = new Set<string>();
  const out: ListItem[] = [];
  // Each feed gives its newest stories per day, a few at a time, so every day mixes the three.
  lists.forEach((r, k) => {
    if (r.status === "rejected") return console.warn(r.reason);
    const perDay = new Map<string, number>();
    for (const n of r.value) {
      if (seen.has(n.id)) continue;
      const taken = perDay.get(n.day) ?? 0;
      if (taken >= FEEDS[k].take) continue;
      perDay.set(n.day, taken + 1);
      seen.add(n.id);
      out.push({ ...n, rank: k * 10 + taken });
    }
  });
  if (!out.length) throw new Error("BBC: no stories in any feed");
  return out.sort((a, b) => (a.day === b.day ? a.rank - b.rank : a.day < b.day ? 1 : -1));
}

// The story's paragraphs from its page, as plain text; the feed's summary when the page has none.
export async function storyText(n: ListItem): Promise<string> {
  try {
    const res = await fetch(n.link, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const body = /<article[\s\S]*?<\/article>/.exec(html)?.[0] ?? html;
    const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((m) => entities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 40);
    const text = paras.slice(0, 30).join("\n");
    if (text.length > 300) return text;
  } catch (e) {
    console.warn(`BBC story ${n.id}:`, e);
  }
  return n.description;
}

export async function storyImage(uri: string): Promise<Uint8Array | null> {
  const res = await fetch(uri, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (res?.ok && res.headers.get("content-type")?.startsWith("image/")) return new Uint8Array(await res.arrayBuffer());
  return null;
}

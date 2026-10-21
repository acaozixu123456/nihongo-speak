import "server-only";

// NHKやさしいことばニュース (NEWS WEB EASY). Since NHK ONE (2025) its article list and full articles need the
// token the site itself gets for a visitor without an account: a consent cookie (household, Tokyo), then
// NHK's usual sign-in redirects, which end with the token in a cookie. Fetched fresh on every run.

const EASY = "https://news.web.nhk/news/easy";
const CONSENT = { status: "optedin", entity: "household", area: { areaId: "130", jisx0402: "13101", postal: "1000001", pref: "13" } };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// Every cookie the redirects set, for every NHK host along the way (all of them are NHK's own).
async function signIn(): Promise<Map<string, string>> {
  const jar = new Map<string, string>([["consentToUse", encodeURIComponent(JSON.stringify(CONSENT))]]);
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  let url = `https://www.web.nhk/tix/build_authorize?${new URLSearchParams({ idp: "r-alaz", profileType: "anonymous", redirect_uri: `${EASY}/` })}`;
  for (let hop = 0; hop < 8; hop++) {
    const res = await fetch(url, { redirect: "manual", headers: { cookie: cookie(), "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    const next = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !next) break;
    url = new URL(next, url).toString();
  }
  if (!jar.get("z_at")) throw new Error("NHK: no token after sign-in");
  return jar;
}

export type NhkSession = { token: string; cookie: string };

export async function nhkSession(): Promise<NhkSession> {
  const jar = await signIn();
  return { token: jar.get("z_at")!, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

// image: NHK's picture for the story (needs the session too).
export type ListItem = { id: string; day: string; at: string; title: string; rank: number; image?: string };

// NHK NEWS WEB's picture, else the one NHK made for sharing the easy article (some stories have only that).
const pic = (has?: boolean, uri?: string) => (has && uri?.startsWith("https://news.web.nhk/") ? { image: uri } : undefined);

// Newest day first; within a day NHK's own order (top_priority_number).
export async function nhkList(s: NhkSession): Promise<ListItem[]> {
  const res = await fetch(`${EASY}/news-list.json`, { headers: { authorization: `Bearer ${s.token}`, "user-agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`NHK list: HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, {
    news_id: string;
    title: string;
    news_prearranged_time: string;
    top_priority_number: number;
    has_news_web_image?: boolean;
    news_web_image_uri?: string;
    has_news_easy_image?: boolean;
    news_easy_image_uri?: string;
  }[]>[];
  const out: ListItem[] = [];
  for (const [day, items] of Object.entries(data[0] ?? {})) {
    for (const n of items) out.push({
      id: n.news_id,
      day,
      at: n.news_prearranged_time,
      title: n.title,
      rank: n.top_priority_number,
      ...(pic(n.has_news_web_image, n.news_web_image_uri) ?? pic(n.has_news_easy_image, n.news_easy_image_uri) ?? {}),
    });
  }
  return out.sort((a, b) => (a.day === b.day ? a.rank - b.rank : a.day < b.day ? 1 : -1));
}

// t: the text; r: its reading where NHK gives one; name: a person, place or group (NHK colours these),
// whose reading the voice is given instead of the kanji, which it could misread.
export type { Seg } from "@/lib/news-model";
import type { Seg } from "@/lib/news-model";

const NAME_CLASS = /class="color[NLC]"/;
const entities = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// One paragraph's HTML (spans holding text and <ruby>) as segments.
export function segments(html: string): Seg[] {
  const out: Seg[] = [];
  const push = (s: Seg) => {
    if (!s.t) return;
    const last = out.at(-1);
    if (last && !last.r && !s.r && !last.name === !s.name) last.t += s.t;
    else out.push(s);
  };
  // The parts inside a coloured name span are marked; everything else is plain.
  const spans = html.split(/(<span[^>]*>[\s\S]*?<\/span>)/);
  for (const part of spans) {
    const name = /^<span/.test(part) && NAME_CLASS.test(part.slice(0, part.indexOf(">") + 1));
    const inner = part.replace(/^<span[^>]*>/, "").replace(/<\/span>$/, "");
    for (const bit of inner.split(/(<ruby>[\s\S]*?<\/ruby>)/)) {
      const ruby = /^<ruby>([\s\S]*?)<rt>([\s\S]*?)<\/rt><\/ruby>$/.exec(bit);
      if (ruby) push({ t: entities(ruby[1].replace(/<[^>]+>/g, "")), r: entities(ruby[2].replace(/<[^>]+>/g, "")), ...(name ? { name: true as const } : {}) });
      else push({ t: entities(bit.replace(/<[^>]+>/g, "").replace(/[ \t\r\n]+/g, "")), ...(name ? { name: true as const } : {}) });
    }
  }
  return out;
}

// A paragraph's segments cut into sentences after 。！？ (a closing 」 stays with its sentence).
export function sentences(segs: Seg[]): Seg[][] {
  const out: Seg[][] = [];
  let cur: Seg[] = [];
  const close = () => {
    if (cur.some((s) => s.t.trim())) out.push(cur);
    cur = [];
  };
  for (const s of segs) {
    if (s.r) {
      cur.push(s);
      continue;
    }
    let rest = s.t;
    let m: RegExpExecArray | null;
    while ((m = /[。！？][」』）]*/.exec(rest))) {
      cur.push({ ...s, t: rest.slice(0, m.index + m[0].length) });
      close();
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) cur.push({ ...s, t: rest });
  }
  close();
  return out;
}

export type NhkArticle = { id: string; title: Seg[]; paras: Seg[][][]; url: string };

export async function nhkArticle(s: NhkSession, id: string): Promise<NhkArticle> {
  const url = `${EASY}/${id}/${id}.html`;
  const res = await fetch(url, { headers: { cookie: s.cookie, authorization: `Bearer ${s.token}`, "user-agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`NHK article ${id}: HTTP ${res.status}`);
  const html = await res.text();
  const title = /<h1 class="article-title">([\s\S]*?)<\/h1>/.exec(html)?.[1];
  const body = /<div class="article-body" id="js-article-body">([\s\S]*?)<\/div>/.exec(html)?.[1];
  if (!title || !body) throw new Error(`NHK article ${id}: no article in the page`);
  const paras = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => sentences(segments(m[1]))).filter((p) => p.length);
  return { id, title: segments(title.trim()), paras, url };
}

// The story's picture as a JPEG: the 640×360 copy (_s) NHK keeps next to the full-size one (_l, ~500 KB).
export async function nhkImage(s: NhkSession, uri: string): Promise<Uint8Array | null> {
  for (const u of [uri.replace(/_l\.jpg$/, "_s.jpg"), uri]) {
    const res = await fetch(u, { headers: { cookie: s.cookie, authorization: `Bearer ${s.token}`, "user-agent": UA }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (res?.ok && res.headers.get("content-type")?.startsWith("image/jpeg")) return new Uint8Array(await res.arrayBuffer());
  }
  return null;
}

export const plain = (segs: Seg[]) => segs.map((s) => s.t).join("");
// What the voice is given: names by their reading.
export const spoken = (segs: Seg[]) => segs.map((s) => (s.name && s.r ? s.r : s.t)).join("");
// Every word NHK gives a reading by its reading: for headlines, which are too terse for the voice to guess (祈る read as 乗る).
export const spokenAll = (segs: Seg[]) => segs.map((s) => s.r ?? s.t).join("");
// With readings inline, for the AI: 経済（けいざい）.
export const withReadings = (segs: Seg[]) => segs.map((s) => (s.r ? `${s.t}（${s.r}）` : s.t)).join("");

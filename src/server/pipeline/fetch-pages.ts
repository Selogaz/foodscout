import { fetchPublicPage } from "./public-fetch";
import { clipText, decodeBody, type PageLink, parseHtml } from "./html";
import type { Candidate, FetchedPage, PipelineLimits } from "./types";

export const USER_AGENT = "FoodScoutBot/0.1 (prototype supplier search; respects robots.txt)";
const ROBOTS_TOKEN = "foodscoutbot";

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchError";
  }
}

type FetchOpts = { fetchImpl?: typeof fetch; timeoutMs: number; maxBytes: number; signal?: AbortSignal };

function withTimeout(ms: number, outer?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return outer ? AbortSignal.any([outer, t]) : t;
}

/** Читает тело ответа не больше maxBytes (остальное отбрасывает). */
async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - off);
    out.set(part, off);
    off += part.length;
    if (off >= out.length) break;
  }
  return out;
}

// ---------- robots.txt ----------

type RobotsRules = { allow: string[]; disallow: string[] };

/** Минимальный разбор robots.txt: группы для нашего токена или для «*», правила Allow/Disallow с * и $. */
export function parseRobots(txt: string): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && val) current.rules.disallow.push(val);
    if (key === "allow" && val) current.rules.allow.push(val);
  }
  const own = groups.find((g) => g.agents.some((a) => a !== "*" && ROBOTS_TOKEN.includes(a)));
  const any = groups.filter((g) => g.agents.includes("*"));
  if (own) return own.rules;
  return { allow: any.flatMap((g) => g.rules.allow), disallow: any.flatMap((g) => g.rules.disallow) };
}

function ruleMatches(rule: string, path: string): number {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(`^${body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return re.test(path) ? body.length : -1;
}

/** Самое длинное совпавшее правило побеждает; при равенстве — Allow (как у Google и Яндекса). */
export function isAllowedByRobots(rules: RobotsRules, pathWithQuery: string): boolean {
  const allow = Math.max(-1, ...rules.allow.map((r) => ruleMatches(r, pathWithQuery)));
  const disallow = Math.max(-1, ...rules.disallow.map((r) => ruleMatches(r, pathWithQuery)));
  return disallow < 0 || allow >= disallow;
}

async function loadRobots(origin: string, o: FetchOpts): Promise<RobotsRules> {
  try {
    const { response: res } = await fetchPublicPage(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: withTimeout(Math.min(4000, o.timeoutMs), o.signal),
      redirect: "manual",
    }, o.fetchImpl);
    if (!res.ok) {
      await res.body?.cancel();
      return { allow: [], disallow: [] };
    }
    const txt = new TextDecoder().decode(await readLimited(res, 200_000));
    return parseRobots(txt);
  } catch {
    // robots.txt недоступен — считаем, что ограничений нет
    return { allow: [], disallow: [] };
  }
}

// ---------- загрузка ----------

const MESSENGER_LINK = /^https?:\/\/(t\.me|telegram\.me|wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|max\.ru)\//i;

type RawPage = { url: string; title: string; text: string; links: PageLink[] };

async function fetchHtml(url: string, o: FetchOpts): Promise<RawPage> {
  let res: Response;
  try {
    ({ response: res, url } = await fetchPublicPage(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": "ru-RU,ru;q=0.9" },
      signal: withTimeout(o.timeoutMs, o.signal),
      redirect: "manual",
    }, o.fetchImpl));
  } catch (e) {
    const name = (e as Error)?.name;
    throw new FetchError(name === "TimeoutError" || name === "AbortError" ? `таймаут ${o.timeoutMs} мс: ${url}` : `сеть: ${(e as Error).message}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new FetchError(`HTTP ${res.status}: ${url}`);
  }
  const type = res.headers.get("content-type");
  if (type && !/html|xml|text\/plain/i.test(type)) {
    await res.body?.cancel();
    throw new FetchError(`не HTML (${type}): ${url}`);
  }
  const bytes = await readLimited(res, o.maxBytes);
  const parsed = parseHtml(decodeBody(bytes, type), res.url || url);
  const extra: string[] = [];
  if (parsed.telLinks.length) extra.push(`Телефоны в ссылках страницы: ${parsed.telLinks.join(", ")}`);
  if (parsed.mailLinks.length) extra.push(`E-mail в ссылках страницы: ${parsed.mailLinks.join(", ")}`);
  const messengers = [...new Set(parsed.links.map((l) => l.href).filter((h) => MESSENGER_LINK.test(h)))];
  if (messengers.length) extra.push(`Мессенджеры в ссылках страницы: ${messengers.slice(0, 5).join(", ")}`);
  return {
    url: res.url || url,
    title: parsed.title,
    text: extra.length ? `${parsed.text}\n${extra.join("\n")}` : parsed.text,
    links: parsed.links,
  };
}

const PAGE_PATTERNS: { kind: FetchedPage["kind"]; re: RegExp }[] = [
  { kind: "contacts", re: /(контакт|contact|kontakt|svyaz|обратная связь|реквизит|rekvizit)/i },
  { kind: "delivery", re: /(доставк|delivery|dostavk|оплат|oplat|shipping)/i },
  { kind: "price", re: /(опт|optom|opt\b|wholesale|прайс|price|цены|сотрудничеств|dilera|дилер|partner|партнер)/i },
  { kind: "about", re: /(о компании|о нас|about|o-kompanii|o-nas|company|производств|proizvodstv)/i },
  { kind: "docs", re: /(сертифик|sertifik|certif|документ|dokument|декларац)/i },
];

/** Выбирает по одной внутренней странице на тип: контакты, доставка, опт/цены, о компании, документы. */
export function pickSubpages(links: PageLink[], origin: string, already: Set<string>, max: number): { url: string; kind: FetchedPage["kind"] }[] {
  const picked: { url: string; kind: FetchedPage["kind"] }[] = [];
  for (const { kind, re } of PAGE_PATTERNS) {
    if (picked.length >= max) break;
    const link = links.find((l) => {
      if (!URL.canParse(l.href) || new URL(l.href).origin !== origin) return false;
      if (already.has(l.href) || picked.some((p) => p.url === l.href)) return false;
      if (/\.(pdf|jpe?g|png|docx?|xlsx?|zip)(\?|$)/i.test(l.href)) return false;
      let path = new URL(l.href).pathname;
      try {
        path = decodeURI(path);
      } catch {
        /* оставляем как есть */
      }
      return re.test(l.text) || re.test(path);
    });
    if (link) picked.push({ url: link.href, kind });
  }
  return picked;
}

const normUrl = (u: string) => u.replace(/\/+$/, "");

/**
 * Загружает страницы кандидата: найденную поиском, главную и до N служебных
 * («контакты», «доставка», «опт», «о компании»). Уважает robots.txt, у каждой страницы таймаут
 * и лимит размера; текст всех страниц вместе ограничен бюджетом символов для модели.
 */
export async function fetchPages(
  candidate: Candidate,
  limits: Pick<PipelineLimits, "maxPagesPerCandidate" | "pageTimeoutMs" | "maxPageBytes" | "maxCharsPerCandidate">,
  deps: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<{ pages: FetchedPage[]; errors: string[] }> {
  const o: FetchOpts = {
    fetchImpl: deps.fetchImpl,
    timeoutMs: limits.pageTimeoutMs,
    maxBytes: limits.maxPageBytes,
    signal: deps.signal,
  };
  const origin = new URL(candidate.url).origin;
  const robots = await loadRobots(origin, o);
  const allowed = (u: string) => {
    const x = new URL(u);
    return isAllowedByRobots(robots, x.pathname + x.search);
  };
  const errors: string[] = [];
  const raw: { page: RawPage; kind: FetchedPage["kind"] }[] = [];
  const seen = new Set<string>();

  const first: { url: string; kind: FetchedPage["kind"] }[] = [{ url: candidate.url, kind: "landing" }];
  if (normUrl(candidate.url) !== normUrl(origin)) first.push({ url: `${origin}/`, kind: "home" });
  const load = async (list: { url: string; kind: FetchedPage["kind"] }[]) => {
    const settled = await Promise.allSettled(
      list.map(async (p) => {
        if (!allowed(p.url)) throw new FetchError(`запрещено robots.txt: ${p.url}`);
        return { page: await fetchHtml(p.url, o), kind: p.kind };
      }),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") {
        if (seen.has(normUrl(s.value.page.url))) continue;
        seen.add(normUrl(s.value.page.url));
        raw.push(s.value);
      } else errors.push((s.reason as Error).message);
    }
  };
  await load(first);
  if (!raw.length) throw new FetchError(`сайт не загрузился (${errors.join("; ")})`);

  const room = Math.max(0, limits.maxPagesPerCandidate - raw.length);
  const links = raw.flatMap((r) => r.page.links);
  const already = new Set([...seen, ...first.map((f) => normUrl(f.url))]);
  const subpages = pickSubpages(links, origin, already, room);
  if (subpages.length) await load(subpages);

  // Бюджет символов: служебным страницам (контакты, доставка) — приоритет
  const order: FetchedPage["kind"][] = ["contacts", "landing", "delivery", "price", "home", "about", "docs"];
  raw.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const perPage = Math.floor(limits.maxCharsPerCandidate / raw.length);
  const pages = raw.map(({ page, kind }) => ({ url: page.url, title: page.title, kind, text: clipText(page.text, perPage) }));
  return { pages, errors };
}

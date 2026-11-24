/** Лёгкое превращение HTML в текст без зависимостей: страницы поставщиков простые, DOM не нужен. */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»",
  mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", trade: "™", deg: "°", times: "×",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bdquo: "„", minus: "−", middot: "·", bull: "•", shy: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export type PageLink = { href: string; text: string };

export type ParsedHtml = {
  title: string;
  text: string;
  links: PageLink[];
  /** Телефоны и почта из ссылок tel:/mailto: — часто их нет в видимом тексте. */
  telLinks: string[];
  mailLinks: string[];
};

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Разбирает HTML: заголовок, видимый текст с переносами по блокам, ссылки. */
export function parseHtml(html: string, baseUrl: string): ParsedHtml {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ");

  const links: PageLink[] = [];
  const telLinks = new Set<string>();
  const mailLinks = new Set<string>();
  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1].trim());
    if (/^tel:/i.test(href)) {
      telLinks.add(safeDecode(href.slice(4)).trim());
      continue;
    }
    if (/^mailto:/i.test(href)) {
      mailLinks.add(safeDecode(href.slice(7).split("?")[0]).trim());
      continue;
    }
    if (/^(javascript:|#)/i.test(href)) continue;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      abs.hash = "";
      links.push({ href: abs.toString(), text: stripTags(m[2]).slice(0, 120) });
    } catch {
      /* битая ссылка — пропускаем */
    }
  }

  const text = decodeEntities(
    body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|table|ul|ol|dd|dt|address)>/gi, "\n")
      .replace(/<(td|th)\b[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ​]+/g, " ")
    .replace(/ *\n[\s|]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  return { title, text, links, telLinks: [...telLinks], mailLinks: [...mailLinks] };
}

/** Кодировка из Content-Type или <meta charset>; по умолчанию utf-8. */
export function detectCharset(contentType: string | null, head: Uint8Array): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const ascii = new TextDecoder("latin1").decode(head.slice(0, 4096));
  const fromMeta = ascii.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  return (fromMeta ?? "utf-8").toLowerCase();
}

export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const charset = detectCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Обрезает длинный текст, сохраняя начало и конец (контакты часто в подвале). */
export function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n[…]\n${text.slice(text.length - tail)}`;
}

/**
 * Проверка «значение подтверждено страницей». Модель возвращает к каждому значению цитату
 * и URL; здесь код убеждается, что цитата действительно есть в тексте этой страницы и что
 * само значение следует из цитаты. Всё, что не подтвердилось, отбрасывается.
 */

/** Нормализация для сравнения текстов: регистр, ё, кавычки, тире, пробелы. */
export function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[  -​  　]/g, " ")
    .replace(/[«»"“”„'’‘`]/g, "")
    .replace(/[—–−‑]/g, "-")
    .replace(/\|/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+([.,;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => normText(s).split(/[^a-zа-я0-9@._+]+/).filter((w) => w.length >= 3);

export type QuoteMatch = "exact" | "tokens" | null;

/**
 * Есть ли цитата в тексте страницы. «exact» — дословно (допускается разбиение многоточием на
 * дословные куски); «tokens» — все слова цитаты есть на странице, но не подряд (слабое
 * подтверждение, уверенность понижается). null — цитата не найдена.
 */
export function findQuote(quote: string, pageText: string): QuoteMatch {
  const q = normText(quote);
  if (q.length < 3) return null;
  const page = normText(pageText);
  const segments = q.split(/\s*(?:\.\.\.|…|\[…\])\s*/).filter((x) => x.length >= 3);
  if (segments.length && segments.every((seg) => page.includes(seg))) return "exact";
  const qw = words(quote);
  if (qw.length >= 3) {
    const pw = new Set(words(pageText));
    if (qw.every((w) => pw.has(w))) return "tokens";
  }
  return null;
}

/** Значение дословно входит в цитату (после нормализации). */
export function containsText(haystack: string, needle: string): boolean {
  const n = normText(needle);
  return n.length > 0 && normText(haystack).includes(n);
}

export const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Телефон подтверждён, если последние 10 цифр (или все, если их меньше) есть среди цифр цитаты. */
export function phoneInText(phone: string, text: string): boolean {
  const d = digitsOf(phone);
  if (d.length < 6) return false;
  const tail = d.slice(-10);
  return digitsOf(text).includes(tail);
}

/**
 * Числа из текста с учётом «1 200», «1,5», «1.200,50». Неоднозначная запись «10.000»
 * даёт оба прочтения (10 и 10000): проверка ищет совпадение с любым.
 */
export function numbersIn(text: string): number[] {
  const t = text.replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, "$1");
  const out: number[] = [];
  for (const [tok] of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(tok)) out.push(Number(tok.replace(/\./g, "").replace(",", ".")));
    else if (/^\d+[.,]\d+$/.test(tok)) out.push(Number(tok.replace(",", ".")));
    else if (/^\d+$/.test(tok)) out.push(Number(tok));
    if (/^\d{1,3}([.,]\d{3})+$/.test(tok)) out.push(Number(tok.replace(/[.,]/g, "")));
  }
  return [...new Set(out.filter(Number.isFinite))];
}

export function numberInText(n: number, text: string): boolean {
  return numbersIn(text).some((x) => Math.abs(x - n) < 1e-9);
}

/** Все числа значения встречаются в источнике (перефраз не должен добавлять цифры). */
export function numbersSupported(value: string, sourceText: string): boolean {
  const src = numbersIn(sourceText);
  return numbersIn(value).every((n) => src.some((x) => Math.abs(x - n) < 1e-9));
}

/** Единица измерения есть в цитате с точностью до словоформы («тонна» ≈ «тонны»). */
export function unitInText(unit: string, text: string): boolean {
  if (containsText(text, unit)) return true;
  const u = normText(unit).replace(/\.$/, "");
  return u.length >= 4 && normText(text).includes(u.slice(0, 4));
}

/** Основы слов для грубого сравнения словоформ. */
const stems = (s: string) => words(s).map((w) => w.slice(0, Math.max(4, Math.min(6, w.length - 2))));

/**
 * Перефразированное значение (описание, условия доставки) опирается на страницу,
 * если большая часть его основ слов встречается в тексте источника.
 */
export function paraphraseSupported(value: string, sourceText: string, minShare = 0.6): boolean {
  if (!numbersSupported(value, sourceText)) return false;
  const vs = [...new Set(stems(value))];
  if (!vs.length) return false;
  const src = normText(sourceText);
  const hit = vs.filter((s) => src.includes(s)).length;
  return hit / vs.length >= minShare;
}

/** Хотя бы одно из имён (основа слова) есть в тексте. */
export function anyNameInText(names: string[], text: string): boolean {
  const t = normText(text);
  return names.some((n) => {
    const nn = normText(n);
    if (nn.length <= 3) return new RegExp(`(^|[^а-яa-z])${nn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^а-яa-z]|$)`).test(t);
    return stems(n).every((s) => t.includes(s));
  });
}

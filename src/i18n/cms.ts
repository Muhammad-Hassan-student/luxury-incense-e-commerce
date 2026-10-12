/**
 * Translation memory for editable CMS copy (home content blocks, the announcement bar).
 *
 * Those strings live in the database in English and staff can change them at any time, so they can't be message
 * keys. Instead each exact English text is looked up by a hash in the `cms` namespace of the messages
 * (`cms.t1a2b3c4d`). Known texts — the seeded copy — are translated for every locale; when staff edit a text its hash
 * changes and the store simply shows their English until a translation for the new wording is added.
 */
export function cmsKey(text: string) {
  // FNV-1a 32-bit over UTF-16 code units, normalised whitespace — stable across server/client and runtimes.
  const s = text.replace(/\r\n/g, "\n").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `t${(h >>> 0).toString(16).padStart(8, "0")}`;
}

type Lookup = { has: (key: string) => boolean; (key: string): string };

/**
 * Wraps a next-intl translator for the `cms` namespace into "English in, best translation out". The keys are
 * computed at runtime, so the translator is used untyped here.
 */
export function cmsTranslator(translator: object) {
  const t = translator as Lookup;
  return (text: string | null | undefined) => {
    if (!text) return text ?? "";
    const key = cmsKey(text);
    return t.has(key) ? t(key) : text;
  };
}

/** Deep-translates the string fields of a content block's data (links, slugs and ids are left alone). */
export function localizeCmsData<T>(data: T, tr: (s: string) => string): T {
  const SKIP = /^(href|url|src|image|productSlug|slug|id|model|video|poster)$/i;
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return key && SKIP.test(key) ? v : tr(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(data) as T;
}

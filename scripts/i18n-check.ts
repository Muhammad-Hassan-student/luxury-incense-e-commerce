// Message catalogue check: every locale has every key of messages/en.json, with the same ICU arguments, plural/select
// shapes and rich-text tags, and every message formats. Fails (exit 1) on any problem.
// Run: npm run test:i18n          (add --list to print the missing keys as JSON, ready to translate)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { IntlMessageFormat } from "intl-messageformat";
import { LOCALES } from "@/i18n/locales";

type Tree = { [k: string]: string | Tree };
const dir = join(process.cwd(), "messages");
const read = (code: string): Tree => JSON.parse(readFileSync(join(dir, `${code}.json`), "utf8"));

function flatten(tree: Tree, prefix = "", out = new Map<string, unknown>()) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Tree, key, out);
    else out.set(key, v);
  }
  return out;
}

/** Arguments ("name:kind"), plural/select option sets, and tags used by a message. */
function shape(message: string) {
  const args = new Set<string>();
  const selects = new Map<string, Set<string>>();
  const plurals = new Map<string, Set<string>>();
  const tags = new Set<string>();
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      switch (el.type) {
        case TYPE.argument:
          args.add(`${el.value}:text`);
          break;
        case TYPE.number:
          args.add(`${el.value}:number`);
          break;
        case TYPE.date:
        case TYPE.time:
          args.add(`${el.value}:date`);
          break;
        case TYPE.plural:
          args.add(`${el.value}:plural`);
          plurals.set(el.value, new Set(Object.keys(el.options)));
          for (const o of Object.values(el.options)) walk(o.value);
          break;
        case TYPE.select:
          args.add(`${el.value}:select`);
          selects.set(el.value, new Set(Object.keys(el.options)));
          for (const o of Object.values(el.options)) walk(o.value);
          break;
        case TYPE.tag:
          tags.add(el.value);
          walk(el.children);
          break;
      }
    }
  };
  walk(parse(message, { ignoreTag: false }));
  return { args, selects, plurals, tags };
}

const sample = (arg: string) => {
  const [, kind] = arg.split(":");
  if (kind === "number" || kind === "plural") return 3;
  if (kind === "date") return new Date(Date.UTC(2026, 0, 15));
  return "x";
};

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

const en = flatten(read("en"));
const problems: string[] = [];
const missingByLocale: Record<string, Record<string, string>> = {};
let untranslated = 0;

for (const [key, value] of en) {
  if (typeof value !== "string") problems.push(`en: ${key} is not a string`);
}

for (const { code, intl } of LOCALES) {
  let tree: Tree;
  try {
    tree = read(code);
  } catch (e) {
    problems.push(`${code}: messages/${code}.json is missing or invalid JSON (${(e as Error).message})`);
    continue;
  }
  const msgs = flatten(tree);
  for (const [key, enValue] of en) {
    if (typeof enValue !== "string") continue;
    const value = msgs.get(key);
    if (value === undefined) {
      if (code !== "en") (missingByLocale[code] ??= {})[key] = enValue;
      continue;
    }
    if (typeof value !== "string") {
      problems.push(`${code}: ${key} is not a string`);
      continue;
    }
    if (code !== "en" && value === enValue && /[a-z]{4,}/i.test(enValue) && !/^[{<]/.test(enValue)) untranslated++;
    let a: ReturnType<typeof shape>, b: ReturnType<typeof shape>;
    try {
      a = shape(enValue);
      b = shape(value);
    } catch (e) {
      problems.push(`${code}: ${key} does not parse as ICU (${(e as Error).message})`);
      continue;
    }
    if (!sameSet(a.args, b.args)) problems.push(`${code}: ${key} arguments differ — en {${[...a.args].join(", ")}} vs {${[...b.args].join(", ")}}`);
    if (!sameSet(a.tags, b.tags)) problems.push(`${code}: ${key} rich-text tags differ — en <${[...a.tags].join(", ")}> vs <${[...b.tags].join(", ")}>`);
    for (const [name, opts] of a.selects) {
      const other = b.selects.get(name);
      if (other && !sameSet(opts, other)) problems.push(`${code}: ${key} select {${name}} options differ`);
    }
    for (const [name, opts] of b.plurals) {
      if (!opts.has("other")) problems.push(`${code}: ${key} plural {${name}} has no "other" case`);
      const allowed = new Set(new Intl.PluralRules(intl).resolvedOptions().pluralCategories as string[]);
      for (const o of opts) if (!o.startsWith("=") && !allowed.has(o)) problems.push(`${code}: ${key} plural {${name}} uses "${o}", which ${intl} never selects`);
    }
    try {
      const values: Record<string, unknown> = {};
      for (const arg of b.args) values[arg.split(":")[0]!] = sample(arg);
      for (const t of b.tags) values[t] = (chunks: unknown) => chunks;
      new IntlMessageFormat(value, intl).format(values as never);
    } catch (e) {
      problems.push(`${code}: ${key} fails to format (${(e as Error).message})`);
    }
  }
  for (const key of msgs.keys()) if (!en.has(key)) problems.push(`${code}: ${key} is not in en.json (stale key)`);
}

const missingCount = Object.values(missingByLocale).reduce((n, m) => n + Object.keys(m).length, 0);
if (process.argv.includes("--list")) console.log(JSON.stringify(missingByLocale, null, 2));
for (const [code, m] of Object.entries(missingByLocale)) {
  const keys = Object.keys(m);
  problems.push(`${code}: ${keys.length} missing key(s): ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", …" : ""}`);
}

const total = en.size;
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(`\ni18n: ${problems.length} problem(s), ${missingCount} missing translation(s) across ${LOCALES.length} locales (${total} keys).`);
  process.exit(1);
}
console.log(`✓ i18n: ${LOCALES.length} locales × ${total} keys complete; arguments, plurals and tags match.${untranslated ? ` (${untranslated} values identical to English — brand names, units, etc.)` : ""}`);

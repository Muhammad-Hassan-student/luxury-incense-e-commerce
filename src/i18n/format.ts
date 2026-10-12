import { useLocale } from "next-intl";
import { intlLocale } from "./locales";

/**
 * The active locale's `Intl` tag for client and server components ("hi" → "hi-IN"):
 * `d.toLocaleDateString(useIntlLocale(), {...})` instead of a hard-coded "en-GB".
 * Server code that is not a component (actions, generateMetadata) uses `getIntlLocale()` from ./server.
 */
export function useIntlLocale() {
  return intlLocale(useLocale());
}

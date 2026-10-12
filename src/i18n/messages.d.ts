import type en from "../../messages/en.json";

// Type-checks every t("…") key against messages/en.json (the source of truth; other locales are checked by
// scripts/i18n-check.ts).
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof en;
  }
}

import "server-only";
import { cache } from "react";
import { z } from "zod";
import { db } from "./db";

export const storeSettingsSchema = z.object({
  announcement: z.string().default(""),
  taxRatePercent: z.number().min(0).max(50).default(18),
  taxInclusive: z.boolean().default(true),
  lowStockThreshold: z.number().int().min(0).default(10),
  giftWrapFee: z.number().int().min(0).default(9900),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const getSettings = cache(async (): Promise<StoreSettings> => {
  const row = await db.setting.findUnique({ where: { key: "store" } });
  return storeSettingsSchema.parse(row?.value ?? {});
});

export const getFlags = cache(async () => {
  const rows = await db.featureFlag.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled])) as Record<string, boolean>;
});

export async function flag(key: string) {
  return (await getFlags())[key] ?? false;
}

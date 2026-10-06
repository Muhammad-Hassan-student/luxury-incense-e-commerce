import "server-only";
import { z } from "zod";
import type { ShopFilters } from "./catalog";

const schema = z.object({
  family: z.enum(["WOODY", "ORIENTAL", "FLORAL", "FRESH", "SPICY", "RESINOUS", "GOURMAND"]).optional().catch(undefined),
  mood: z.string().max(30).optional().catch(undefined),
  sort: z.enum(["featured", "price-asc", "price-desc", "new", "rating"]).optional().catch(undefined),
  q: z.string().max(80).optional().catch(undefined),
});

export function parseShopParams(sp: Record<string, string | string[] | undefined>): ShopFilters {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return schema.parse(flat);
}

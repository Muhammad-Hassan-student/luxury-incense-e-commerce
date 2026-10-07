"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { storeSettingsSchema, type StoreSettings } from "@/server/settings";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";

function revalidateSettings() {
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  revalidatePath("/", "layout");
}

export async function saveStoreSettings(input: StoreSettings): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = storeSettingsSchema.strict().safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const value = { ...parsed.data, announcement: parsed.data.announcement.trim().slice(0, 300) };
  await db.setting.upsert({ where: { key: "store" }, update: { value }, create: { key: "store", value } });
  await audit(user.id, "settings.update", "Setting", "store", value);
  revalidateSettings();
  return done("Settings saved");
}

const flagSchema = z.object({ key: z.string().min(1).max(100), enabled: z.boolean() });

export async function setFeatureFlag(input: z.input<typeof flagSchema>): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const updated = await db.featureFlag.updateMany({ where: { key: parsed.data.key }, data: { enabled: parsed.data.enabled } });
  if (!updated.count) return fail("Unknown flag.");
  await audit(user.id, "flag.set", "FeatureFlag", parsed.data.key, { enabled: parsed.data.enabled });
  revalidateSettings();
  return done(`${parsed.data.key} ${parsed.data.enabled ? "on" : "off"}`);
}

const rateSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(2).max(80),
  countries: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^([A-Z]{2}|\*)$/, "Use 2-letter ISO codes or *"),
    )
    .min(1, "Add at least one country (or * for rest of world)")
    .max(250),
  /** Major units. */
  price: z.number().min(0).max(1_000_000),
  freeOver: z.number().min(0).max(10_000_000).nullable(),
  etaDays: z.string().trim().min(1).max(40),
  position: z.number().int().min(0).max(1000),
});

export async function saveShippingRate(input: z.input<typeof rateSchema>): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, ...r } = parsed.data;
  const data = {
    name: r.name,
    countries: [...new Set(r.countries)],
    price: toMinor(r.price),
    freeOver: r.freeOver === null ? null : toMinor(r.freeOver),
    etaDays: r.etaDays,
    position: r.position,
  };
  const saved = id
    ? await db.shippingRate.update({ where: { id }, data, select: { id: true } }).catch(() => null)
    : await db.shippingRate.create({ data, select: { id: true } });
  if (!saved) return fail("Shipping rate not found.");
  await audit(user.id, id ? "shipping.update" : "shipping.create", "ShippingRate", saved.id, data);
  revalidateSettings();
  return done(id ? "Rate saved" : "Rate added", saved.id);
}

const idSchema = z.object({ id: cuid });

export async function deleteShippingRate(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const remaining = await db.shippingRate.count();
  if (remaining <= 1) return fail("Keep at least one shipping rate, or checkout will stop working.");
  const rate = await db.shippingRate.findUnique({ where: { id: parsed.data.id } });
  if (!rate) return fail("Shipping rate not found.");
  await db.shippingRate.delete({ where: { id: parsed.data.id } });
  await audit(user.id, "shipping.delete", "ShippingRate", rate.id, { name: rate.name, countries: rate.countries, price: rate.price });
  revalidateSettings();
  return done("Rate deleted");
}

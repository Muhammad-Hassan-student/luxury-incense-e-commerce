"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { signIn, signOut } from "@/auth";

const addressSchema = z.object({
  fullName: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  postalCode: z.string().min(3).max(12),
  country: z.string().length(2),
});

export async function saveAddress(input: z.infer<typeof addressSchema> & { id?: string }) {
  const user = await requireUser();
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Please complete every field." };
  if (input.id) {
    await db.address.updateMany({ where: { id: input.id, userId: user.id }, data: parsed.data });
  } else {
    const count = await db.address.count({ where: { userId: user.id } });
    await db.address.create({ data: { ...parsed.data, userId: user.id, isDefault: count === 0 } });
  }
  revalidatePath("/account/addresses");
  return { ok: true as const };
}

export async function deleteAddress(id: string) {
  const user = await requireUser();
  await db.address.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/account/addresses");
}

export async function makeDefaultAddress(id: string) {
  const user = await requireUser();
  await db.$transaction([
    db.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } }),
    db.address.updateMany({ where: { id, userId: user.id }, data: { isDefault: true } }),
  ]);
  revalidatePath("/account/addresses");
}

export async function updateProfile(input: { name: string; phone?: string }) {
  const user = await requireUser();
  const parsed = z.object({ name: z.string().min(1).max(100), phone: z.string().max(20).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Enter your name." };
  await db.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/account");
  return { ok: true as const };
}

export async function signInWithEmail(email: string, callbackUrl = "/account") {
  if (!z.string().email().safeParse(email).success) return { ok: false as const, error: "Enter a valid email." };
  await signIn("resend", { email, redirectTo: callbackUrl });
  return { ok: true as const };
}

export async function signInWithGoogle(callbackUrl = "/account") {
  await signIn("google", { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

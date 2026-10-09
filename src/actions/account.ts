"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { rateLimit } from "@/server/rate-limit";
import { deleteAccount, PrivacyError } from "@/server/privacy";
import { AuthError } from "next-auth";
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
  try {
    await signIn("resend", { email, redirectTo: callbackUrl });
  } catch (e) {
    // signIn() finishes by throwing a redirect: let that through. Anything else means the email didn't go out.
    if (e instanceof AuthError) {
      console.error("[signin] sending the magic link failed:", e.cause ?? e.message);
      return { ok: false as const, error: "We couldn't send your sign-in email right now. Please try again in a minute." };
    }
    throw e;
  }
  return { ok: true as const };
}

export async function signInWithGoogle(callbackUrl = "/account") {
  await signIn("google", { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

const deleteSchema = z.object({ email: z.string().trim().email().max(254), phrase: z.literal("DELETE") });

/** Erases the signed-in customer's personal data, then signs them out. */
export async function deleteMyAccount(input: { email: string; phrase: string }): Promise<{ ok: false; error: string }> {
  const user = await requireUser();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Type DELETE and your email address to confirm." };
  if (!(await rateLimit("delete-account", 3, 600)).ok) return { ok: false, error: "Too many attempts. Please try again in a few minutes." };
  try {
    await deleteAccount(user.id, parsed.data);
  } catch (e) {
    if (e instanceof PrivacyError) return { ok: false, error: e.message };
    console.error("[account] deletion failed", e);
    return { ok: false, error: "We couldn’t delete your account just now. Nothing was changed — please try again." };
  }
  // Sessions are already gone from the database; drop the cookie too.
  const jar = await cookies();
  for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) jar.delete(name);
  revalidatePath("/", "layout");
  redirect("/");
}

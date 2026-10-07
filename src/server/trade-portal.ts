import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { requireUser } from "./roles";
import { getTradeAccountByUser } from "./trade";

/** Signed-in user's trade account (any status), or null. Redirects to sign-in when signed out. Cached per request. */
export const portalAccount = cache(async (path: string) => {
  const user = await requireUser(path);
  return { user, account: await getTradeAccountByUser(user.id) };
});

/** The approved account for portal pages, or null (the portal layout then shows the status page instead). */
export async function approvedBuyer(path: string) {
  const { account } = await portalAccount(path);
  return account?.status === "APPROVED" ? account : null;
}

/** Without redirecting: the visitor's trade status for public pages (landing CTA). */
export async function tradeStatusForVisitor() {
  const session = await auth();
  if (!session?.user) return { signedIn: false as const, status: null };
  const account = await getTradeAccountByUser(session.user.id);
  return { signedIn: true as const, status: account?.status ?? null };
}

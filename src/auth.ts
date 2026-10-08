import NextAuth, { type DefaultSession } from "next-auth";
import { cookies } from "next/headers";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { env, integrations } from "@/env";
import { sendEmail } from "@/server/email";
import { MagicLinkEmail } from "@/emails/magic-link";
import { mergeGuestCartInto } from "@/server/cart";
import { rememberDevMagicLink } from "@/server/dev-magic-link";
import { withSecondStep } from "@/server/security/adapter";
import { tolerateMissingTables } from "@/server/security/state";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
}

const adminEmails = env.ADMIN_EMAILS.split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The adapter is typed against @prisma/client; our client is generated to src/generated.
  // withSecondStep: when Face ID / phone lock is on, step 1 only creates a short pending session that every auth()
  // call treats as signed out until /signin/verify completes the second step (see src/server/security/adapter.ts).
  adapter: withSecondStep(PrismaAdapter(db as never)),
  session: { strategy: "database", maxAge: 60 * 60 * 24 * 30 },
  // Auth.js appends ?provider=resend&type=email to verifyRequest; /signin shows "check your inbox" for that.
  pages: { signIn: "/signin", verifyRequest: "/signin", error: "/signin" },
  trustHost: true,
  providers: [
    ...(integrations.google ? [Google] : []),
    // Magic links always work: sent via Resend when configured, printed to the server log otherwise.
    Resend({
      apiKey: env.RESEND_API_KEY ?? "dev",
      from: env.EMAIL_FROM,
      async sendVerificationRequest({ identifier, url }) {
        rememberDevMagicLink(identifier, url);
        await sendEmail({
          to: identifier,
          subject: "Your sign-in link",
          react: MagicLinkEmail({ url }),
          devLog: `Sign-in link for ${identifier}: ${url}`,
        });
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = (user as unknown as { role: Role }).role;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      const isOwner = Boolean(user.email && adminEmails.includes(user.email.toLowerCase()));
      const ref = (await cookies()).get("mo_ref")?.value;
      const referrer = ref ? await db.user.findUnique({ where: { referralCode: ref }, select: { id: true } }) : null;
      await db.user.update({
        where: { id: user.id },
        data: {
          ...(isOwner && { role: "OWNER" }),
          ...(referrer && referrer.id !== user.id && { referredById: referrer.id }),
        },
      });
    },
    async signIn({ user }) {
      if (!user.id) return;
      // A pending (step-1 only) sign-in merges the guest bag only after the second step succeeds.
      const userId = user.id;
      const pending = await tolerateMissingTables(
        db,
        false,
        () => db.sessionSecondStep.count({ where: { userId, verifiedAt: null, createdAt: { gt: new Date(Date.now() - 60_000) } } }),
        0,
      ).catch(() => 1);
      if (!pending) await mergeGuestCartInto(userId).catch(() => {});
    },
  },
});

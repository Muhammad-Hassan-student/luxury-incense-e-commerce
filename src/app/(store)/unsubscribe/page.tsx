import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/config/brand";
import { journeyEmailsAllowed, verifyUnsubscribeToken } from "@/server/marketing";
import { UnsubscribeForm } from "@/components/account/unsubscribe-form";

export const metadata: Metadata = { title: "Email preferences", robots: { index: false } };

const mask = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
};

export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const sp = await props.searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  const email = verifyUnsubscribeToken(token);
  const allowed = email ? await journeyEmailsAllowed(email) : false;

  return (
    <section className="mx-auto max-w-xl px-6 pt-40 pb-32 text-center">
      <p className="eyebrow mb-4">Email preferences</p>
      {email ? (
        <>
          <h1 className="font-display text-4xl font-light sm:text-5xl">{allowed ? "Fewer letters?" : "You’re unsubscribed"}</h1>
          <p className="mt-6 text-sm text-muted">
            {allowed
              ? `Stop ${brand.name} journey emails — welcome notes, reminders and personal offers — to ${mask(email)}. Order and delivery updates will still arrive.`
              : `${mask(email)} won’t receive journey emails from ${brand.name}. Order and delivery updates still arrive.`}
          </p>
          <UnsubscribeForm token={token} allowed={allowed} />
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl font-light sm:text-5xl">This link isn’t valid</h1>
          <p className="mt-6 text-sm text-muted">
            Use the unsubscribe link from one of our emails, or{" "}
            <Link href="/account" className="link-draw text-gold">
              sign in
            </Link>{" "}
            to change your preferences.
          </p>
        </>
      )}
    </section>
  );
}

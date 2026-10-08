import type { Metadata } from "next";
import { EnrollFlow } from "./enroll-flow";

export const metadata: Metadata = { title: "Add a phone or face", robots: { index: false }, referrer: "no-referrer" };

/**
 * One-time enrollment link: /signin/enroll#<token>. The token lives in the URL fragment, so it never reaches server
 * logs or Referer headers. The page asks only for the account's email + the emailed code, then adds a phone lock or a
 * face to THAT account. It never signs anyone in.
 */
export default function EnrollPage() {
  return (
    <div className="container-luxe grid min-h-[70svh] items-start gap-12 py-16 md:py-20 lg:grid-cols-2 lg:items-center lg:gap-16">
      <div>
        <p className="eyebrow mb-6">Sign-in security</p>
        <h1 className="display text-5xl md:text-7xl">
          Add a phone <em className="text-gold">or face</em>
        </h1>
        <p className="mt-6 max-w-sm text-muted">
          Someone shared this one-time link so you can add your phone lock or your face to their Maison Oud account. It doesn’t sign you in, works once and
          expires 30 minutes after it was made.
        </p>
      </div>
      <div className="w-full max-w-md">
        <EnrollFlow />
      </div>
    </div>
  );
}

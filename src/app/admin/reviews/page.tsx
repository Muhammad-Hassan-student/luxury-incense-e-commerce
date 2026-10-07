import Link from "next/link";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { ReviewActions } from "@/components/admin/review-actions";
import { Empty, PageHeader, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { fmtDateTime } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={cn("size-3.5", i < rating ? "fill-gold text-gold" : "text-line-strong")} aria-hidden strokeWidth={1.25} />
      ))}
    </span>
  );
}

export default async function ReviewsPage(props: PageProps<"/admin/reviews">) {
  const user = await requireAnyPermission("reviews.view", "reviews.moderate");
  const canEdit = can(user, "reviews.moderate");
  const sp = await props.searchParams;
  const showApproved = param(sp.view) === "approved";

  const [pendingCount, reviews] = await Promise.all([
    db.review.count({ where: { approved: false } }),
    db.review.findMany({
      where: { approved: showApproved },
      orderBy: { createdAt: showApproved ? "desc" : "asc" },
      take: 100,
      include: { product: { select: { id: true, name: true } }, user: { select: { email: true, name: true } } },
    }),
  ]);

  const tab = (active: boolean) =>
    cn("border-b-2 px-1 pb-2 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors", active ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg");

  return (
    <>
      <PageHeader eyebrow="Community" title="Reviews">
        Approving publishes the review and updates the product rating.
      </PageHeader>

      <nav className="mb-6 flex gap-6 border-b border-line" aria-label="Review filter">
        <Link href="/admin/reviews" className={tab(!showApproved)} aria-current={!showApproved ? "page" : undefined}>
          Pending · {pendingCount}
        </Link>
        <Link href="/admin/reviews?view=approved" className={tab(showApproved)} aria-current={showApproved ? "page" : undefined}>
          Published
        </Link>
      </nav>

      {reviews.length ? (
        <ul className="divide-y divide-line border border-line bg-bg-elev">
          {reviews.map((r) => (
            <li key={r.id} className="grid gap-4 px-5 py-6 lg:grid-cols-[1fr_auto] lg:items-start">
              <article>
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={r.rating} />
                  <Link href={`/admin/products/${r.product.id}`} className={cn(linkClass, "text-sm")}>
                    {r.product.name}
                  </Link>
                  {r.verified ? <Badge>Verified buyer</Badge> : <Badge tone="muted">Unverified</Badge>}
                </div>
                <h2 className="mt-3 font-display text-xl font-light text-fg">{r.title}</h2>
                <p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted">{r.body}</p>
                {r.photos.length ? <p className="mt-2 text-xs text-subtle">{r.photos.length} photo(s) attached</p> : null}
                <p className="mt-3 text-xs text-subtle">
                  {r.user.name ?? r.user.email} · {r.user.email} · {fmtDateTime(r.createdAt)}
                </p>
              </article>
              {canEdit ? <ReviewActions id={r.id} approved={r.approved} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{showApproved ? "No published reviews yet." : "The queue is clear."}</Empty>
      )}
    </>
  );
}

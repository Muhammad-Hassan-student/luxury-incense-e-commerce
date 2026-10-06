import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { db } from "@/server/db";
import { requireRole } from "@/server/roles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireRole("SUPPORT");
  const pendingReviews = await db.review.count({ where: { approved: false } });
  return (
    <AdminShell user={{ name: user.name ?? null, email: user.email ?? "", role: user.role }} pendingReviews={pendingReviews}>
      {children}
    </AdminShell>
  );
}

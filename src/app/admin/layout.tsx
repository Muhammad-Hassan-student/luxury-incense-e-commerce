import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { db } from "@/server/db";
import { can, requireStaff } from "@/server/roles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireStaff();
  const pendingReviews = can(user, "reviews.view") ? await db.review.count({ where: { approved: false } }) : 0;
  return (
    <AdminShell user={{ name: user.name, email: user.email, roleName: user.roleName, permissions: user.permissions }} pendingReviews={pendingReviews}>
      {children}
    </AdminShell>
  );
}

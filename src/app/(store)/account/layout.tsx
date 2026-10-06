import Link from "next/link";
import { requireUser, hasRole } from "@/server/roles";
import { signOutAction } from "@/actions/account";
import { AccountNav } from "@/components/account/account-nav";

export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  const user = await requireUser("/account");
  return (
    <div className="container-luxe pt-16">
      <div className="mb-14 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow mb-4">Your account</p>
          <h1 className="display text-5xl md:text-7xl">{user.name ? `Hello, ${user.name.split(" ")[0]}` : "Hello"}</h1>
        </div>
        <div className="flex items-center gap-6">
          {hasRole(user.role, "SUPPORT") && (
            <Link href="/admin" className="link-draw eyebrow">Store admin</Link>
          )}
          <form action={signOutAction}>
            <button className="link-draw text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">Sign out</button>
          </form>
        </div>
      </div>
      <div className="grid gap-12 lg:grid-cols-[14rem_1fr]">
        <AccountNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

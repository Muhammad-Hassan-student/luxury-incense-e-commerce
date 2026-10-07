import { auth } from "@/auth";
import { rateLimit } from "@/server/rate-limit";
import { exportUserData } from "@/server/privacy";

/** GET: the signed-in customer's own data as a JSON download. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to download your data." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!(await rateLimit("data-export", 5, 300)).ok) {
    return Response.json({ error: "Too many downloads. Try again in a few minutes." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const data = await exportUserData(session.user.id);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="maison-oud-my-data-${day}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

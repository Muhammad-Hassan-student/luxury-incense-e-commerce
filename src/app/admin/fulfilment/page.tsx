import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/admin/ui";
import { FulfilmentBoard } from "@/components/admin/fulfilment/board";
import { can, requirePermission } from "@/server/roles";
import { getCourier } from "@/server/courier";
import { boardData } from "@/server/courier/fulfilment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fulfilment" };

export default async function FulfilmentPage() {
  const access = await requirePermission("orders.fulfil");
  const now = new Date();
  const [{ cards, awaitingCod }, { client }] = await Promise.all([boardData(now), getCourier()]);
  const testMode = client.mode === "test";

  return (
    <>
      <PageHeader
        eyebrow="Fulfilment"
        title="Dispatch board"
        actions={
          testMode ? (
            <span className="inline-flex items-center gap-2 border border-gold/40 px-3 py-1.5 text-[0.625rem] uppercase tracking-[0.2em] text-gold">
              <FlaskConical className="size-3.5" aria-hidden /> Test mode
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 border border-line-strong px-3 py-1.5 text-[0.625rem] uppercase tracking-[0.2em] text-muted">Shiprocket live</span>
          )
        }
      >
        Pack, label and hand over — then watch every parcel to the door.
        {testMode ? (
          <>
            {" "}
            Shiprocket isn’t connected, so AWBs, labels and tracking are simulated.
            {can(access, "settings.manage") ? (
              <>
                {" "}
                <Link href="/admin/integrations" className="text-fg underline decoration-line-strong underline-offset-4 hover:text-gold">
                  Connect it
                </Link>
                .
              </>
            ) : null}
          </>
        ) : null}
      </PageHeader>
      <FulfilmentBoard cards={cards} awaitingCod={awaitingCod} mode={client.mode} serverNow={now.toISOString()} />
    </>
  );
}

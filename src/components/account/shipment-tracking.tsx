import { db } from "@/server/db";
import { trackingView } from "@/server/courier/tracking";
import { TrackingTimeline } from "@/components/tracking/tracking-timeline";

/** Live courier timeline on the customer's order page. Renders nothing until a courier shipment exists. */
export async function ShipmentTracking({ orderId }: { orderId: string }) {
  const has = await db.shipment.count({ where: { orderId, awb: { not: null } } });
  if (!has) return null;
  const view = await trackingView(orderId);
  if (!view) return null;
  return (
    <section aria-labelledby="tracking-heading" className="border border-line p-6 sm:p-8">
      <p id="tracking-heading" className="eyebrow mb-6">
        Delivery tracking
      </p>
      <TrackingTimeline view={view} compact />
    </section>
  );
}

import "server-only";
import { db } from "./db";

/** Records a provider event id; returns false if we've already processed it. */
export async function firstDelivery(id: string, provider: string) {
  try {
    await db.webhookEvent.create({ data: { id, provider } });
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false;
    throw e;
  }
}

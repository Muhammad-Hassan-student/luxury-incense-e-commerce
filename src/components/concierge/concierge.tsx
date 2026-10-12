import { getAiFeatures } from "@/server/ai/config";
import { brand } from "@/config/brand";
import { ConciergeClient } from "./concierge-client";

/** Floating "Ask the perfumer" chat. Hidden when the concierge is switched off in Admin → AI. */
export async function Concierge() {
  const features = await getAiFeatures().catch(() => null);
  if (!features?.concierge) return null;
  return <ConciergeClient careEmail={brand.email} />;
}

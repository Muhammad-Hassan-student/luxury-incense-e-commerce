import "server-only";
import { registerSupportHandoff, supportHandoffRegistered } from "../ai/handoff";
import { createTicket } from "./index";

/**
 * Plugs the support desk into the concierge's "Talk to a person": the chat becomes a CHAT ticket with the
 * (PII-redacted) transcript as an internal note for staff. Guests without an email can't get a reply, so createTicket
 * refuses them and the concierge falls back to showing the care team's contact details.
 */
export function installChatHandoff() {
  if (supportHandoffRegistered()) return;
  registerSupportHandoff(async (chat) => {
    const firstQuestion = chat.transcript.find((m) => m.role === "user")?.content ?? "";
    const t = await createTicket({
      source: "chat",
      subject: chat.subject,
      body: chat.note?.trim() || firstQuestion || "I'd like to talk to a person.",
      userId: chat.userId,
      email: chat.email,
      name: chat.name,
      externalRef: chat.conversationId,
      tags: ["concierge"],
      transcript: chat.transcript.map((m) => ({ role: m.role === "user" ? "customer" : "assistant", text: m.content })),
    });
    return { ticketId: t.id, ticketNumber: t.reference };
  });
}

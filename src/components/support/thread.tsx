import { cn } from "@/lib/utils";

/** Server-safe message thread for the account page and the staff inbox. */
export type ThreadMessage = { id: string; author: string; authorName: string | null; body: string; attachments: string[]; createdAt: Date; internal?: boolean; via?: string };

export function Thread({ messages, labels, staffView = false }: { messages: ThreadMessage[]; labels: { you: string; team: string; internal?: string }; staffView?: boolean }) {
  const fmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <ol className="space-y-4">
      {messages.map((m) => {
        const fromCustomer = m.author === "customer";
        const system = m.author === "system";
        // Customers see their own messages on the end side; staff see the customer on the start side.
        const end = staffView ? !fromCustomer : fromCustomer;
        const who = fromCustomer ? (staffView ? (m.authorName ?? "Customer") : labels.you) : system ? (m.authorName ?? "System") : staffView ? (m.authorName ?? labels.team) : labels.team;
        return (
          <li key={m.id} className={cn("flex", end ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "w-full max-w-[min(36rem,92%)] border px-4 py-3",
                m.internal ? "border-dashed border-gold/50 bg-gold/5" : fromCustomer ? "border-line bg-bg-elev" : "border-line-strong bg-bg-soft",
                system && "max-w-full",
              )}
            >
              <p className="mb-2 flex flex-wrap items-center gap-x-2 text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
                <span className={cn(!fromCustomer && !system && "text-gold")}>{who}</span>
                <span aria-hidden>·</span>
                <time dateTime={m.createdAt.toISOString()}>{fmt.format(m.createdAt)}</time>
                {m.internal && labels.internal ? <span className="text-gold">· {labels.internal}</span> : null}
                {staffView && m.via && m.via !== "admin" ? <span>· {m.via}</span> : null}
              </p>
              <p className="whitespace-pre-line break-words text-sm leading-relaxed text-fg">{m.body}</p>
              {m.attachments.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {m.attachments.map((u) => (
                    <li key={u}>
                      <a href={u} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="Attachment" className="size-20 border border-line object-cover" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

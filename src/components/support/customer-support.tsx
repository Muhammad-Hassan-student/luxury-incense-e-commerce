"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { openSupportTicket, replyToSupportTicket } from "@/actions/support";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SUPPORT_TOPICS, type SupportTopic } from "@/lib/support-shared";
import { AttachmentPicker } from "./attachment-picker";

function useAttachLabels() {
  const t = useTranslations("support");
  return { attach: t("attach"), hint: t("attachHint"), uploading: t("uploading"), remove: t("removePhoto") };
}

/** New request with an order picker (prefilled from ?order=). */
export function NewTicketForm({ orders, defaultOrder }: { orders: { number: string; label: string }[]; defaultOrder?: string | null }) {
  const t = useTranslations("support");
  const labels = useAttachLabels();
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState<SupportTopic>(defaultOrder ? "order" : "other");
  const [order, setOrder] = useState(defaultOrder && orders.some((o) => o.number === defaultOrder) ? defaultOrder : "");
  const [files, setFiles] = useState<string[]>([]);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await openSupportTicket({ subject, body, topic, orderNumber: order || null, attachments: files });
          if (!r.ok) return void toast.error(r.error);
          toast(t("created", { ref: r.reference }));
          router.push(`/account/support/${r.number}`);
        });
      }}
    >
      <div className="grid gap-8 sm:grid-cols-2">
        <Field label={t("topic")}>
          <Select value={topic} onChange={(e) => setTopic(e.target.value as SupportTopic)}>
            {SUPPORT_TOPICS.map((k) => (
              <option key={k} value={k}>
                {t(`topic_${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("order")}>
          <Select value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="">{t("noOrder")}</option>
            {orders.map((o) => (
              <option key={o.number} value={o.number}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("subject")}>
        <Input required minLength={3} maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("subjectPlaceholder")} />
      </Field>
      <Field label={t("message")}>
        <Textarea required minLength={2} maxLength={5000} rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("messagePlaceholder")} />
      </Field>
      <AttachmentPicker value={files} onChange={setFiles} labels={labels} />
      <Button type="submit" disabled={pending}>
        {pending ? t("sending") : t("send")}
      </Button>
    </form>
  );
}

/** Customer reply box under the thread. */
export function CustomerReplyForm({ number }: { number: number }) {
  const t = useTranslations("support");
  const labels = useAttachLabels();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await replyToSupportTicket({ number, body, attachments: files });
          if (!r.ok) return void toast.error(r.error);
          setBody("");
          setFiles([]);
          router.refresh();
        });
      }}
    >
      <Field label={t("reply")}>
        <Textarea required rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("replyPlaceholder")} />
      </Field>
      <AttachmentPicker value={files} onChange={setFiles} labels={labels} />
      <Button type="submit" size="sm" disabled={pending || !body.trim()}>
        {pending ? t("sending") : t("send")}
      </Button>
    </form>
  );
}

"use client";

import * as A from "@radix-ui/react-accordion";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

export function Accordion({ items, defaultOpen }: { items: { id: string; title: string; content: ReactNode }[]; defaultOpen?: string }) {
  return (
    <A.Root type="single" collapsible defaultValue={defaultOpen} className="border-t border-line">
      {items.map((i) => (
        <A.Item key={i.id} value={i.id} className="border-b border-line">
          <A.Header>
            <A.Trigger className="group flex w-full items-center justify-between py-5 text-start text-[0.6875rem] uppercase tracking-[0.28em]">
              {i.title}
              <Plus className="size-3.5 transition-transform duration-500 ease-luxe group-data-[state=open]:rotate-45" />
            </A.Trigger>
          </A.Header>
          <A.Content className="overflow-hidden data-[state=closed]:animate-[collapse_0.5s_var(--ease-luxe)] data-[state=open]:animate-[expand_0.6s_var(--ease-luxe)]">
            <div className="pb-6 text-sm leading-relaxed text-muted">{i.content}</div>
          </A.Content>
        </A.Item>
      ))}
    </A.Root>
  );
}

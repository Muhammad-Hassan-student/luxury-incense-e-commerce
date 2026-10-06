"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteAddress, makeDefaultAddress, saveAddress } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/field";

type Address = { id: string; fullName: string; phone: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; isDefault: boolean };
const empty = { fullName: "", phone: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "IN" };

export function AddressBook({ addresses }: { addresses: Address[] }) {
  const [editing, setEditing] = useState<(typeof empty & { id?: string }) | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-10">
      <div className="grid gap-4 md:grid-cols-2">
        {addresses.map((a) => (
          <div key={a.id} className="flex flex-col justify-between gap-6 border border-line p-6">
            <div className="text-sm leading-relaxed text-muted">
              <p className="mb-2 flex items-center gap-3 font-display text-xl text-fg">
                {a.fullName} {a.isDefault && <Badge>Default</Badge>}
              </p>
              {a.line1}{a.line2 && `, ${a.line2}`}<br />{a.city}, {a.state} {a.postalCode}<br />{a.country} · {a.phone}
            </div>
            <div className="flex gap-6 text-[0.6875rem] uppercase tracking-[0.24em]">
              <button onClick={() => setEditing(a)} className="link-draw">Edit</button>
              {!a.isDefault && <button onClick={() => start(() => makeDefaultAddress(a.id))} className="link-draw text-muted">Make default</button>}
              <button onClick={() => start(() => deleteAddress(a.id))} className="link-draw text-ember">Remove</button>
            </div>
          </div>
        ))}
      </div>
      {editing ? (
        <form
          className="grid gap-8 border border-line p-8 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await saveAddress(editing);
              if (res.ok) {
                toast("Address saved");
                setEditing(null);
              } else toast.error(res.error);
            });
          }}
        >
          {(
            [
              ["fullName", "Full name"],
              ["phone", "Phone"],
              ["line1", "Address"],
              ["line2", "Apartment, suite"],
              ["city", "City"],
              ["state", "State / region"],
              ["postalCode", "Postal code"],
              ["country", "Country code (e.g. IN)"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <Input value={editing[k]} onChange={(e) => setEditing({ ...editing, [k]: k === "country" ? e.target.value.toUpperCase().slice(0, 2) : e.target.value })} required={k !== "line2"} />
            </Field>
          ))}
          <div className="flex gap-4 sm:col-span-2">
            <Button type="submit" disabled={pending}>Save address</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setEditing({ ...empty })}>Add an address</Button>
      )}
    </div>
  );
}

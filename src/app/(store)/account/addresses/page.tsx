import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { AddressBook } from "@/components/account/address-book";

export default async function AddressesPage() {
  const user = await requireUser("/account/addresses");
  const addresses = await db.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return (
    <AddressBook
      addresses={addresses.map((a) => ({ id: a.id, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state, postalCode: a.postalCode, country: a.country, isDefault: a.isDefault }))}
    />
  );
}

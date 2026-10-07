import { Button, Column, Heading, Row, Section, Text } from "@react-email/components";
import { EmailLayout, button, colors, h1, p, siteUrl } from "./layout";

export type LowStockEmailItem = { sku: string; product: string; label: string; available: number; reorderPoint: number; onOrder: number; supplier: string | null };

const cell = { fontSize: 13, color: colors.fg, padding: "8px 0", borderBottom: `1px solid ${colors.line}` };
const head = { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase" as const, color: colors.muted, padding: "0 0 8px", borderBottom: `1px solid ${colors.line}` };
const num = { textAlign: "right" as const, width: 72 };

/** Daily digest for staff: variants at or below their reorder point, with what's already on order. */
export function LowStockEmail({ items, day }: { items: LowStockEmailItem[]; day: string }) {
  const shown = items.slice(0, 60);
  return (
    <EmailLayout preview={`${items.length} variant${items.length === 1 ? "" : "s"} need reordering`}>
      <Heading style={h1}>Low stock</Heading>
      <Text style={p}>
        {items.length} variant{items.length === 1 ? " is" : "s are"} at or below the reorder point ({day}). Quantities on order are from open purchase orders.
      </Text>
      <Section>
        <Row>
          <Column style={head}>Variant</Column>
          <Column style={{ ...head, ...num }}>Avail.</Column>
          <Column style={{ ...head, ...num }}>Reorder at</Column>
          <Column style={{ ...head, ...num }}>On order</Column>
        </Row>
        {shown.map((i) => (
          <Row key={i.sku}>
            <Column style={cell}>
              {i.product} · {i.label}
              <br />
              <span style={{ fontSize: 11, color: colors.muted }}>
                {i.sku}
                {i.supplier ? ` · ${i.supplier}` : ""}
              </span>
            </Column>
            <Column style={{ ...cell, ...num, color: i.available <= 0 ? "#d9734e" : colors.gold }}>{i.available}</Column>
            <Column style={{ ...cell, ...num }}>{i.reorderPoint}</Column>
            <Column style={{ ...cell, ...num }}>{i.onOrder || "—"}</Column>
          </Row>
        ))}
      </Section>
      {items.length > shown.length ? <Text style={p}>…and {items.length - shown.length} more.</Text> : null}
      <Section style={{ marginTop: 24 }}>
        <Button href={`${siteUrl()}/admin/purchasing`} style={button}>
          Review reorders
        </Button>
      </Section>
    </EmailLayout>
  );
}

/** Client-safe shapes shared by inventory/purchasing components and their server actions. */

export type VariantOption = { id: string; sku: string; label: string; product: string; costPrice: number | null; stock: number; supplierId: string | null };

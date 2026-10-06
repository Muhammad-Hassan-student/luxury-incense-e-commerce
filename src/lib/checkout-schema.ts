import { z } from "zod";

export const checkoutSchema = z.object({
  email: z.string().email("Enter a valid email"),
  fullName: z.string().min(2, "Enter your full name").max(100),
  phone: z.string().regex(/^[+\d][\d\s-]{6,18}$/, "Enter a valid phone number"),
  line1: z.string().min(3, "Enter your address").max(200),
  line2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().min(2, "Enter a city").max(100),
  state: z.string().min(2, "Enter a state or region").max(100),
  postalCode: z.string().min(3, "Enter a postal code").max(12),
  country: z.string().length(2),
  shippingRateId: z.string().min(1),
  provider: z.enum(["STRIPE", "RAZORPAY", "COD"]),
  pointsRequested: z.coerce.number().int().min(0).default(0),
  giftWrap: z.boolean().default(false),
  giftNote: z.string().max(300).optional(),
  deliveryDate: z.string().optional(),
  saveAddress: z.boolean().default(false),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

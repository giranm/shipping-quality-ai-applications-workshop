import { z } from "zod";

export const customerTierSchema = z.enum(["free", "pro", "enterprise"]);
export const productAreaSchema = z.enum(["billing", "auth", "api", "general"]);
export const categorySchema = productAreaSchema;
export const severitySchema = z.enum(["low", "medium", "high", "critical"]);

export const ticketInputSchema = z.object({
  ticket: z.string().min(1),
  customer_tier: customerTierSchema.optional(),
  account_id: z.string().min(1).optional(),
  product_area: productAreaSchema.optional(),
});

export const triageResultSchema = z.object({
  category: categorySchema,
  severity: severitySchema,
  should_escalate: z.boolean(),
  escalation_reason: z.string(),
  recommended_action: z.string().min(1),
  customer_reply: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type TicketInput = z.infer<typeof ticketInputSchema>;
export type TriageResult = z.infer<typeof triageResultSchema>;

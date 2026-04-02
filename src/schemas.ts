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

export const helpCenterResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string().min(1)),
  snippet: z.string().min(1),
});

export const recentAccountEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  summary: z.string().min(1),
  occurred_at: z.string().min(1),
});

export const escalationResultSchema = z.object({
  id: z.string().min(1),
  queue: z.string().min(1),
  eta_minutes: z.number().int().positive(),
  reason: z.string().min(1),
});

export const triageEvidenceSchema = z.object({
  help_center_results: z.array(helpCenterResultSchema),
  recent_account_events: z.array(recentAccountEventSchema),
});

export const triageSpecialistDraftSchema = z.object({
  category: categorySchema,
  severity: severitySchema,
  should_escalate: z.boolean(),
  escalation_reason: z.string(),
  recommended_action: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence_summary: z.string().min(1),
});

export const policyReviewerActionSchema = z.enum(["approved", "revised"]);

export const policyReviewerDecisionSchema = z.object({
  reviewer_action: policyReviewerActionSchema,
  category: categorySchema,
  severity: severitySchema,
  should_escalate: z.boolean(),
  escalation_reason: z.string(),
  recommended_action: z.string().min(1),
  confidence: z.number().min(0).max(1),
  review_notes: z.string().min(1),
});

export const replyWriterOutputSchema = z.object({
  customer_reply: z.string().min(1),
});

export type TicketInput = z.infer<typeof ticketInputSchema>;
export type TriageResult = z.infer<typeof triageResultSchema>;
export type HelpCenterResult = z.infer<typeof helpCenterResultSchema>;
export type RecentAccountEvent = z.infer<typeof recentAccountEventSchema>;
export type EscalationResult = z.infer<typeof escalationResultSchema>;
export type TriageEvidence = z.infer<typeof triageEvidenceSchema>;
export type TriageSpecialistDraft = z.infer<typeof triageSpecialistDraftSchema>;
export type PolicyReviewerDecision = z.infer<typeof policyReviewerDecisionSchema>;
export type ReplyWriterOutput = z.infer<typeof replyWriterOutputSchema>;

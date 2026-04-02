import {
  escalationResultSchema,
  policyReviewerDecisionSchema,
  replyWriterOutputSchema,
  triageResultSchema,
  type EscalationResult,
  type PolicyReviewerDecision,
  type ReplyWriterOutput,
  type TriageResult,
} from "../schemas.js";
import { createEscalation } from "../tools.js";

export type FinalizeResultArgs = {
  reviewedDecision: PolicyReviewerDecision;
  reply: ReplyWriterOutput;
};

export type FinalizedSupportTriage = {
  escalation: EscalationResult | null;
  result: TriageResult;
};

export function finalizeResult(args: FinalizeResultArgs): FinalizedSupportTriage {
  const reviewedDecision = policyReviewerDecisionSchema.parse(args.reviewedDecision);
  const reply = replyWriterOutputSchema.parse(args.reply);
  const escalationReason = reviewedDecision.should_escalate
    ? reviewedDecision.escalation_reason.trim() || reviewedDecision.recommended_action.trim()
    : "";

  const result = triageResultSchema.parse({
    category: reviewedDecision.category,
    severity: reviewedDecision.severity,
    should_escalate: reviewedDecision.should_escalate,
    escalation_reason: escalationReason,
    recommended_action: reviewedDecision.recommended_action,
    customer_reply: reply.customer_reply.trim(),
    confidence: reviewedDecision.confidence,
  });

  return {
    escalation: result.should_escalate
      ? escalationResultSchema.parse(createEscalation(result.escalation_reason))
      : null,
    result,
  };
}

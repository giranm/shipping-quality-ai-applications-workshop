import {
  policyReviewerDecisionSchema,
  replyWriterOutputSchema,
  triageResultSchema,
  type PolicyReviewerDecision,
  type ReplyWriterOutput,
  type TriageResult,
} from "../schemas.js";

export type FinalizeResultArgs = {
  reviewedDecision: PolicyReviewerDecision;
  reply: ReplyWriterOutput;
};

export function finalizeResult(args: FinalizeResultArgs): TriageResult {
  const reviewedDecision = policyReviewerDecisionSchema.parse(args.reviewedDecision);
  const reply = replyWriterOutputSchema.parse(args.reply);
  const customerReply = reply.customer_reply.trim();

  if (!customerReply) {
    throw new Error("Reply writer produced an empty customer_reply.");
  }

  const escalationReason = reviewedDecision.should_escalate
    ? reviewedDecision.escalation_reason.trim() || reviewedDecision.recommended_action.trim()
    : "";

  return triageResultSchema.parse({
    category: reviewedDecision.category,
    severity: reviewedDecision.severity,
    should_escalate: reviewedDecision.should_escalate,
    escalation_reason: escalationReason,
    recommended_action: reviewedDecision.recommended_action,
    customer_reply: customerReply,
    confidence: reviewedDecision.confidence,
  });
}

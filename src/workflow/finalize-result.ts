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

type MaybePromise<T> = T | Promise<T>;

export type FinalizeResultArgs = {
  reviewedDecision: PolicyReviewerDecision;
  reply: ReplyWriterOutput;
  dependencies?: {
    createEscalation?: (reason: string) => MaybePromise<EscalationResult>;
  };
};

export type FinalizedSupportTriage = {
  escalation: EscalationResult | null;
  result: TriageResult;
};

export async function finalizeResult(args: FinalizeResultArgs): Promise<FinalizedSupportTriage> {
  const reviewedDecision = policyReviewerDecisionSchema.parse(args.reviewedDecision);
  const reply = replyWriterOutputSchema.parse(args.reply);
  const createEscalationRecord = args.dependencies?.createEscalation ?? createEscalation;
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
      ? escalationResultSchema.parse(await Promise.resolve(createEscalationRecord(result.escalation_reason)))
      : null,
    result,
  };
}

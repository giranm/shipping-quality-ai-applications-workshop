import type { EvalScorer } from "braintrust";

import { triageResultSchema, type TicketInput, type TriageResult } from "../schemas.js";
import type { EvalExpected } from "./dataset.js";

type NamedScore = {
  name: string;
  score: number | null;
  metadata?: Record<string, unknown>;
};

type TriageScorer = EvalScorer<TicketInput, TriageResult, EvalExpected, Record<string, unknown>>;

function score(name: string, value: number | null, metadata?: Record<string, unknown>): NamedScore {
  return {
    name,
    score: value,
    metadata,
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export const categoryExactMatch: TriageScorer = ({ output, expected }) =>
  score("category_exact", output.category === expected.category ? 1 : 0);

export const severityExactMatch: TriageScorer = ({ output, expected }) =>
  score("severity_exact", output.severity === expected.severity ? 1 : 0);

export const escalationExactMatch: TriageScorer = ({ output, expected }) =>
  score("escalation_exact", output.should_escalate === expected.should_escalate ? 1 : 0);

export const schemaValidity: TriageScorer = ({ output }) =>
  score("schema_valid", triageResultSchema.safeParse(output).success ? 1 : 0);

export const requiredFieldsPresent: TriageScorer = ({ output }) => {
  const hasAction = output.recommended_action.trim().length > 0;
  const hasReply = output.customer_reply.trim().length > 0;
  const hasEscalationReason = !output.should_escalate || output.escalation_reason.trim().length > 0;

  return score("required_fields_present", hasAction && hasReply && hasEscalationReason ? 1 : 0);
};

export const escalationReasonWhenEscalated: TriageScorer = ({ output }) =>
  score(
    "escalation_reason_present",
    output.should_escalate ? (output.escalation_reason.trim().length > 0 ? 1 : 0) : 1,
  );

export const blockedEnterpriseNotLowSeverity: TriageScorer = ({ input, output }) => {
  const normalizedTicket = input.ticket.toLowerCase();
  const looksBusinessCritical =
    input.customer_tier === "enterprise" &&
    /(blocked|cannot|can't|failing|finance|cfo|close|sso|admin|launch)/.test(normalizedTicket);

  return score("enterprise_blocked_not_low", looksBusinessCritical ? (output.severity === "low" ? 0 : 1) : 1);
};

export const confidenceRange: TriageScorer = ({ output }) =>
  score("confidence_in_range", output.confidence >= 0 && output.confidence <= 1 ? 1 : 0);

export const customerReplyRubric: TriageScorer = ({ output }) => {
  const reply = output.customer_reply.toLowerCase();
  const empathy = /(thanks|sorry|understand|appreciate)/.test(reply) ? 1 : 0;
  const actionability = /(check|review|investigat|follow up|escalat|look into|update|verify)/.test(reply) ? 1 : 0;
  const avoidingOverpromising = /(guarantee|definitely fixed|will be fixed immediately)/.test(reply) ? 0 : 1;
  const correctness = output.should_escalate ? (/(escalat|team|ops|engineering|billing|auth)/.test(reply) ? 1 : 0.5) : 1;
  const combined = average([empathy, actionability, avoidingOverpromising, correctness]);

  return [
    score("reply_empathy", empathy),
    score("reply_actionability", actionability),
    score("reply_avoid_overpromising", avoidingOverpromising),
    score("reply_correctness", correctness),
    score("customer_reply_rubric", combined),
  ];
};

export const triageScorers: TriageScorer[] = [
  categoryExactMatch,
  severityExactMatch,
  escalationExactMatch,
  schemaValidity,
  requiredFieldsPresent,
  escalationReasonWhenEscalated,
  blockedEnterpriseNotLowSeverity,
  confidenceRange,
  customerReplyRubric,
];

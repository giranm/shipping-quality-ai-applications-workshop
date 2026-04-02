import type { EvalScorer } from "braintrust";

import type { TicketInput, TriageResult } from "../schemas.js";
import type { EvalExpected } from "./dataset.js";
import {
  scoreCategoryExact,
  scoreConfidenceInRange,
  scoreConflictingSignalsActionable,
  scoreEnterpriseBlockedNotLow,
  scoreEscalationExact,
  scoreEscalationReasonPresent,
  scoreLowContextConfidenceCap,
  scoreReplyRubric,
  scoreRequiredFieldsPresent,
  scoreReviewerOverrideGuardrail,
  scoreSchemaValidity,
  scoreSeverityExact,
  type ScoreResult,
} from "./scorer-logic.js";

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

function namedScore(name: string, result: ScoreResult): NamedScore {
  return score(name, result.score, result.metadata);
}

export const categoryExactMatch: TriageScorer = ({ output, expected }) =>
  namedScore("category_exact", scoreCategoryExact({ output, expected }));

export const severityExactMatch: TriageScorer = ({ output, expected }) =>
  namedScore("severity_exact", scoreSeverityExact({ output, expected }));

export const escalationExactMatch: TriageScorer = ({ output, expected }) =>
  namedScore("escalation_exact", scoreEscalationExact({ output, expected }));

export const schemaValidity: TriageScorer = ({ output }) =>
  namedScore("schema_valid", scoreSchemaValidity({ output }));

export const requiredFieldsPresent: TriageScorer = ({ output }) =>
  namedScore("required_fields_present", scoreRequiredFieldsPresent({ output }));

export const escalationReasonWhenEscalated: TriageScorer = ({ output }) =>
  namedScore("escalation_reason_present", scoreEscalationReasonPresent({ output }));

export const blockedEnterpriseNotLowSeverity: TriageScorer = ({ input, output }) =>
  namedScore("enterprise_blocked_not_low", scoreEnterpriseBlockedNotLow({ input, output }));

export const confidenceRange: TriageScorer = ({ output }) =>
  namedScore("confidence_in_range", scoreConfidenceInRange({ output }));

export const reviewerOverrideGuardrail: TriageScorer = ({ output, metadata }) =>
  namedScore("reviewer_override_guardrail", scoreReviewerOverrideGuardrail({ output, metadata }));

export const conflictingSignalsActionable: TriageScorer = ({ output, metadata }) =>
  namedScore("conflicting_signals_actionable", scoreConflictingSignalsActionable({ output, metadata }));

export const lowContextConfidenceCap: TriageScorer = ({ input, output, metadata }) =>
  namedScore("low_context_confidence_cap", scoreLowContextConfidenceCap({ input, output, metadata }));

export const customerReplyRubric: TriageScorer = ({ output }) => {
  const rubric = scoreReplyRubric({ output });

  return [
    namedScore("reply_empathy", rubric.reply_empathy),
    namedScore("reply_actionability", rubric.reply_actionability),
    namedScore("reply_avoid_overpromising", rubric.reply_avoid_overpromising),
    namedScore("reply_correctness", rubric.reply_correctness),
    namedScore("customer_reply_rubric", rubric.customer_reply_rubric),
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
  reviewerOverrideGuardrail,
  conflictingSignalsActionable,
  lowContextConfidenceCap,
  customerReplyRubric,
];

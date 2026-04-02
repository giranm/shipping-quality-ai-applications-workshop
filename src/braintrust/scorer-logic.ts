import {
  policyReviewerDecisionSchema,
  replyWriterOutputSchema,
  ticketInputSchema,
  triageResultSchema,
  triageSpecialistDraftSchema,
  type TicketInput,
  type TriageResult,
} from "../schemas.js";

export type ScorerLogicArgs = {
  input?: unknown;
  output: unknown;
  expected?: Partial<TriageResult> | undefined;
  metadata?: Record<string, unknown>;
};

export type ScoreResult = {
  score: number;
  metadata?: Record<string, unknown>;
};

export type ReplyRubricScores = {
  reply_empathy: ScoreResult;
  reply_actionability: ScoreResult;
  reply_avoid_overpromising: ScoreResult;
  reply_correctness: ScoreResult;
  customer_reply_rubric: ScoreResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function score(value: number, metadata?: Record<string, unknown>): ScoreResult {
  return {
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

function hasMetadataFlag(metadata: Record<string, unknown> | undefined, flag: string): boolean {
  return metadata?.[flag] === true;
}

function hasHighSeverity(output: TriageResult): boolean {
  return output.severity === "high" || output.severity === "critical";
}

export function extractTicketInput(input: unknown): TicketInput | null {
  const parsed = ticketInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function extractTriageResult(output: unknown): TriageResult | null {
  const directResult = triageResultSchema.safeParse(output);
  if (directResult.success) {
    return directResult.data;
  }

  if (!isRecord(output)) {
    return null;
  }

  const nestedResult = triageResultSchema.safeParse(output.result);
  return nestedResult.success ? nestedResult.data : null;
}

export function extractReplyText(output: unknown): string | null {
  const replyOutput = replyWriterOutputSchema.safeParse(output);
  if (replyOutput.success) {
    return replyOutput.data.customer_reply;
  }

  return extractTriageResult(output)?.customer_reply ?? null;
}

export function scoreCategoryExact(args: ScorerLogicArgs): ScoreResult {
  const output = extractTriageResult(args.output);
  return score(output?.category === args.expected?.category ? 1 : 0);
}

export function scoreSeverityExact(args: ScorerLogicArgs): ScoreResult {
  const output = extractTriageResult(args.output);
  return score(output?.severity === args.expected?.severity ? 1 : 0);
}

export function scoreEscalationExact(args: ScorerLogicArgs): ScoreResult {
  const output = extractTriageResult(args.output);
  return score(output?.should_escalate === args.expected?.should_escalate ? 1 : 0);
}

export function scoreSchemaValidity(args: ScorerLogicArgs): ScoreResult {
  return score(extractTriageResult(args.output) ? 1 : 0);
}

export function scoreRequiredFieldsPresent(args: ScorerLogicArgs): ScoreResult {
  const output = extractTriageResult(args.output);

  if (!output) {
    return score(0);
  }

  const hasAction = output.recommended_action.trim().length > 0;
  const hasReply = output.customer_reply.trim().length > 0;
  const hasEscalationReason = !output.should_escalate || output.escalation_reason.trim().length > 0;

  return score(hasAction && hasReply && hasEscalationReason ? 1 : 0);
}

export function scoreEscalationReasonPresent(args: ScorerLogicArgs): ScoreResult {
  const output = extractTriageResult(args.output);

  if (!output) {
    return score(0);
  }

  return score(output.should_escalate ? (output.escalation_reason.trim().length > 0 ? 1 : 0) : 1);
}

export function scoreEnterpriseBlockedNotLow(args: ScorerLogicArgs): ScoreResult {
  const input = extractTicketInput(args.input);
  const output = extractTriageResult(args.output);

  if (!input || !output) {
    return score(0);
  }

  const normalizedTicket = input.ticket.toLowerCase();
  const looksBusinessCritical =
    input.customer_tier === "enterprise" &&
    /(blocked|cannot|can't|failing|finance|cfo|close|sso|admin)/.test(normalizedTicket);

  return score(looksBusinessCritical ? (output.severity === "low" ? 0 : 1) : 1);
}

export function scoreConfidenceInRange(args: ScorerLogicArgs): ScoreResult {
  const output = extractTriageResult(args.output);

  if (!output) {
    return score(0);
  }

  return score(output.confidence >= 0 && output.confidence <= 1 ? 1 : 0);
}

export function scoreReviewerOverrideGuardrail(args: ScorerLogicArgs): ScoreResult {
  const output = extractTriageResult(args.output);

  if (!output) {
    return score(0);
  }

  if (!hasMetadataFlag(args.metadata, "reviewer_override_expected")) {
    return score(1);
  }

  return score(output.should_escalate && hasHighSeverity(output) ? 1 : 0);
}

export function scoreConflictingSignalsActionable(args: ScorerLogicArgs): ScoreResult {
  const output = extractTriageResult(args.output);

  if (!output) {
    return score(0);
  }

  if (!hasMetadataFlag(args.metadata, "conflicting_signals_case")) {
    return score(1);
  }

  const action = output.recommended_action.toLowerCase();
  const hasActionableVerb = /(check|verify|review|investigat|compare|confirm|restore)/.test(action);
  const severityNotLow = output.severity !== "low";

  return score(hasActionableVerb && severityNotLow ? 1 : 0);
}

export function scoreLowContextConfidenceCap(args: ScorerLogicArgs): ScoreResult {
  const input = extractTicketInput(args.input);
  const output = extractTriageResult(args.output);

  if (!output) {
    return score(0);
  }

  const taggedLowContext = hasMetadataFlag(args.metadata, "low_context_case");
  const inferredLowContext =
    !input?.account_id && /(something feels off|not sure|intermittent|do not have)/i.test(input?.ticket ?? "");

  if (!taggedLowContext && !inferredLowContext) {
    return score(1);
  }

  return score(output.confidence <= 0.7 ? 1 : 0, {
    confidence: output.confidence,
  });
}

export function scoreReplyRubric(args: ScorerLogicArgs): ReplyRubricScores {
  const reply = extractReplyText(args.output)?.toLowerCase() ?? "";
  const triageResult = extractTriageResult(args.output);
  const empathy = /(thanks|sorry|understand|appreciate)/.test(reply) ? 1 : 0;
  const actionability = /(check|review|investigat|follow up|escalat|look into)/.test(reply) ? 1 : 0;
  const avoidingOverpromising = /(guarantee|definitely fixed|will be fixed immediately)/.test(reply) ? 0 : 1;
  const correctness =
    triageResult?.should_escalate === true ? (/(escalat|billing team|support team)/.test(reply) ? 1 : 0.5) : 1;
  const combined = average([empathy, actionability, avoidingOverpromising, correctness]);

  return {
    reply_empathy: score(empathy),
    reply_actionability: score(actionability),
    reply_avoid_overpromising: score(avoidingOverpromising),
    reply_correctness: score(correctness),
    customer_reply_rubric: score(combined),
  };
}

export function scoreStageOutputPresent(args: ScorerLogicArgs): ScoreResult {
  const hasStructuredOutput =
    triageSpecialistDraftSchema.safeParse(args.output).success ||
    policyReviewerDecisionSchema.safeParse(args.output).success ||
    replyWriterOutputSchema.safeParse(args.output).success;

  return score(hasStructuredOutput ? 1 : 0);
}

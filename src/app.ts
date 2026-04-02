import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  buildLocalPolicyReviewerSystemPrompt,
  buildLocalPolicyReviewerUserPrompt,
  buildLocalReplyWriterSystemPrompt,
  buildLocalReplyWriterUserPrompt,
  buildLocalTriageSpecialistSystemPrompt,
  buildLocalTriageSpecialistUserPrompt,
  type PromptContext,
} from "./prompts.js";
import {
  escalationResultSchema,
  policyReviewerDecisionSchema,
  replyWriterOutputSchema,
  ticketInputSchema,
  triageEvidenceSchema,
  triageSpecialistDraftSchema,
  triageResultSchema,
  type EscalationResult,
  type TicketInput,
  type TriageResult,
} from "./schemas.js";
import { createEscalation, lookupRecentAccountEvents, searchHelpCenter } from "./tools.js";

export type RunSupportTriageOptions = {
  client?: OpenAI;
  model?: string;
};

export type SupportTriageRun = {
  input: TicketInput;
  context: PromptContext;
  stages: {
    triage_specialist: ReturnType<typeof triageSpecialistDraftSchema.parse>;
    policy_reviewer: ReturnType<typeof policyReviewerDecisionSchema.parse>;
    reply_writer: ReturnType<typeof replyWriterOutputSchema.parse>;
  };
  escalation: EscalationResult | null;
  result: TriageResult;
};

function createClient(client?: OpenAI): OpenAI {
  if (client) {
    return client;
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function getModel(model?: string): string {
  return model ?? process.env.OPENAI_MODEL ?? "gpt-5-mini";
}

export async function runSupportTriage(
  input: TicketInput,
  options: RunSupportTriageOptions = {},
): Promise<TriageResult> {
  return (await runSupportTriageDetailed(input, options)).result;
}

export async function runSupportTriageDetailed(
  input: TicketInput,
  options: RunSupportTriageOptions = {},
): Promise<SupportTriageRun> {
  const parsedInput = ticketInputSchema.parse(input);
  const context = triageEvidenceSchema.parse({
    help_center_results: searchHelpCenter(parsedInput.ticket),
    recent_account_events: lookupRecentAccountEvents(parsedInput.account_id),
  });
  const client = createClient(options.client);
  const model = getModel(options.model);

  const triageDraftResponse = await client.responses.parse({
    model,
    instructions: buildLocalTriageSpecialistSystemPrompt(),
    input: buildLocalTriageSpecialistUserPrompt(parsedInput, context),
    text: {
      format: zodTextFormat(triageSpecialistDraftSchema, "triage_specialist_draft"),
    },
  });

  if (!triageDraftResponse.output_parsed) {
    throw new Error("Triage specialist returned no parsed draft.");
  }

  const triageDraft = triageSpecialistDraftSchema.parse(triageDraftResponse.output_parsed);

  const reviewerResponse = await client.responses.parse({
    model,
    instructions: buildLocalPolicyReviewerSystemPrompt(),
    input: buildLocalPolicyReviewerUserPrompt(parsedInput, context, triageDraft),
    text: {
      format: zodTextFormat(policyReviewerDecisionSchema, "policy_reviewer_decision"),
    },
  });

  if (!reviewerResponse.output_parsed) {
    throw new Error("Policy reviewer returned no parsed decision.");
  }

  const reviewedDecision = policyReviewerDecisionSchema.parse(reviewerResponse.output_parsed);

  const replyResponse = await client.responses.parse({
    model,
    instructions: buildLocalReplyWriterSystemPrompt(),
    input: buildLocalReplyWriterUserPrompt(parsedInput, reviewedDecision),
    text: {
      format: zodTextFormat(replyWriterOutputSchema, "reply_writer_output"),
    },
  });

  if (!replyResponse.output_parsed) {
    throw new Error("Reply writer returned no parsed output.");
  }

  const reply = replyWriterOutputSchema.parse(replyResponse.output_parsed);
  const result = triageResultSchema.parse({
    category: reviewedDecision.category,
    severity: reviewedDecision.severity,
    should_escalate: reviewedDecision.should_escalate,
    escalation_reason: reviewedDecision.should_escalate
      ? reviewedDecision.escalation_reason.trim() || reviewedDecision.recommended_action.trim()
      : "",
    recommended_action: reviewedDecision.recommended_action,
    customer_reply: reply.customer_reply.trim(),
    confidence: reviewedDecision.confidence,
  });
  const escalation = result.should_escalate
    ? escalationResultSchema.parse(createEscalation(result.escalation_reason))
    : null;

  return {
    input: parsedInput,
    context,
    stages: {
      triage_specialist: triageDraft,
      policy_reviewer: reviewedDecision,
      reply_writer: reply,
    },
    escalation,
    result,
  };
}

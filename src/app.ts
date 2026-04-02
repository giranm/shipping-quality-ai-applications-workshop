import OpenAI from "openai";

import { type PromptContext } from "./prompts.js";
import { ticketInputSchema, type EscalationResult, type TicketInput, type TriageResult } from "./schemas.js";
import { collectContext } from "./workflow/collect-context.js";
import { finalizeResult } from "./workflow/finalize-result.js";
import { runPolicyReviewer } from "./workflow/policy-reviewer.js";
import { runReplyWriter } from "./workflow/reply-writer.js";
import { runTriageSpecialist } from "./workflow/triage-specialist.js";

export type RunSupportTriageOptions = {
  client?: OpenAI;
  model?: string;
};

export type SupportTriageRun = {
  input: TicketInput;
  context: PromptContext;
  stages: {
    triage_specialist: Awaited<ReturnType<typeof runTriageSpecialist>>;
    policy_reviewer: Awaited<ReturnType<typeof runPolicyReviewer>>;
    reply_writer: Awaited<ReturnType<typeof runReplyWriter>>;
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
  const client = createClient(options.client);
  const model = getModel(options.model);
  const context = await collectContext({ input: parsedInput });
  const triageDraft = await runTriageSpecialist({
    client,
    input: parsedInput,
    evidence: context,
    model,
  });
  const reviewedDecision = await runPolicyReviewer({
    client,
    input: parsedInput,
    evidence: context,
    draft: triageDraft,
    model,
  });
  const reply = await runReplyWriter({
    client,
    input: parsedInput,
    reviewedDecision,
    model,
  });
  const finalized = finalizeResult({
    reviewedDecision,
    reply,
  });

  return {
    input: parsedInput,
    context,
    stages: {
      triage_specialist: triageDraft,
      policy_reviewer: reviewedDecision,
      reply_writer: reply,
    },
    escalation: finalized.escalation,
    result: finalized.result,
  };
}

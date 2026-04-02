import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { buildSystemPrompt, buildUserPrompt, type PromptContext } from "./prompts.js";
import {
  escalationResultSchema,
  ticketInputSchema,
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
  const context: PromptContext = {
    help_center_results: searchHelpCenter(parsedInput.ticket),
    recent_account_events: lookupRecentAccountEvents(parsedInput.account_id),
  };
  const response = await createClient(options.client).responses.parse({
    model: getModel(options.model),
    instructions: buildSystemPrompt(),
    input: buildUserPrompt(parsedInput, context),
    text: {
      format: zodTextFormat(triageResultSchema, "triage_result"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("Support triage returned no parsed result.");
  }

  const result = triageResultSchema.parse(response.output_parsed);
  const escalation = result.should_escalate
    ? escalationResultSchema.parse(createEscalation(result.escalation_reason))
    : null;

  return {
    input: parsedInput,
    context,
    escalation,
    result,
  };
}

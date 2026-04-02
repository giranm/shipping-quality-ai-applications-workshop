import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { ticketInputSchema, triageResultSchema, type TicketInput, type TriageResult } from "./schemas.js";

export type RunSupportTriageOptions = {
  client?: OpenAI;
  model?: string;
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
  const parsedInput = ticketInputSchema.parse(input);
  const response = await createClient(options.client).responses.parse({
    model: getModel(options.model),
    instructions: buildSystemPrompt(),
    input: buildUserPrompt(parsedInput),
    text: {
      format: zodTextFormat(triageResultSchema, "triage_result"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("Support triage returned no parsed result.");
  }

  return triageResultSchema.parse(response.output_parsed);
}

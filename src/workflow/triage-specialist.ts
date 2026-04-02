import { loadPrompt } from "braintrust";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";

import {
  ticketInputSchema,
  triageEvidenceSchema,
  triageSpecialistDraftSchema,
  type TicketInput,
  type TriageEvidence,
  type TriageSpecialistDraft,
} from "../schemas.js";
import {
  buildLocalTriageSpecialistSystemPrompt,
  buildLocalTriageSpecialistUserPrompt,
  buildManagedTriageSpecialistVariables,
} from "../prompts.js";
import { parseStructuredResponse } from "../openai-responses.js";

export type StagePromptMode = "local" | "managed";

export type ManagedPromptRef = {
  projectName: string;
  slug: string;
  apiKey?: string;
};

export type RunTriageSpecialistArgs = {
  client: OpenAI;
  input: TicketInput;
  evidence: TriageEvidence;
  model: string;
  promptMode?: StagePromptMode;
  managedPrompt?: ManagedPromptRef;
};

export async function runTriageSpecialist(
  args: RunTriageSpecialistArgs,
): Promise<TriageSpecialistDraft> {
  const input = ticketInputSchema.parse(args.input);
  const evidence = triageEvidenceSchema.parse(args.evidence);
  const promptMode = args.promptMode ?? "local";

  let messages: ChatCompletionMessageParam[];

  if (promptMode === "managed") {
    if (!args.managedPrompt) {
      throw new Error("Managed prompt configuration is required when promptMode=managed.");
    }

    const prompt = await loadPrompt({
      projectName: args.managedPrompt.projectName,
      slug: args.managedPrompt.slug,
      apiKey: args.managedPrompt.apiKey,
    });
    const compiled = prompt.build(buildManagedTriageSpecialistVariables(input, evidence), {
      flavor: "chat",
    });
    messages = compiled.messages as ChatCompletionMessageParam[];
  } else {
    messages = [
      {
        role: "system",
        content: buildLocalTriageSpecialistSystemPrompt(),
      },
      {
        role: "user",
        content: buildLocalTriageSpecialistUserPrompt(input, evidence),
      },
    ];
  }

  return await parseStructuredResponse({
    client: args.client,
    messages,
    model: args.model,
    schema: triageSpecialistDraftSchema,
    schemaName: "triage_specialist_draft",
  });
}

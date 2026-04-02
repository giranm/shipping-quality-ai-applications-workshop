import { loadPrompt } from "braintrust";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";

import {
  policyReviewerDecisionSchema,
  ticketInputSchema,
  triageEvidenceSchema,
  triageSpecialistDraftSchema,
  type PolicyReviewerDecision,
  type TicketInput,
  type TriageEvidence,
  type TriageSpecialistDraft,
} from "../schemas.js";
import {
  buildLocalPolicyReviewerSystemPrompt,
  buildLocalPolicyReviewerUserPrompt,
  buildManagedPolicyReviewerVariables,
} from "../prompts.js";
import { parseStructuredResponse } from "../openai-responses.js";
import type { ManagedPromptRef, StagePromptMode } from "./triage-specialist.js";

export type RunPolicyReviewerArgs = {
  client: OpenAI;
  input: TicketInput;
  evidence: TriageEvidence;
  draft: TriageSpecialistDraft;
  model: string;
  promptMode?: StagePromptMode;
  managedPrompt?: ManagedPromptRef;
};

export async function runPolicyReviewer(args: RunPolicyReviewerArgs): Promise<PolicyReviewerDecision> {
  const input = ticketInputSchema.parse(args.input);
  const evidence = triageEvidenceSchema.parse(args.evidence);
  const draft = triageSpecialistDraftSchema.parse(args.draft);
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
    const compiled = prompt.build(buildManagedPolicyReviewerVariables(input, evidence, draft), {
      flavor: "chat",
    });
    messages = compiled.messages as ChatCompletionMessageParam[];
  } else {
    messages = [
      {
        role: "system",
        content: buildLocalPolicyReviewerSystemPrompt(),
      },
      {
        role: "user",
        content: buildLocalPolicyReviewerUserPrompt(input, evidence, draft),
      },
    ];
  }

  return await parseStructuredResponse({
    client: args.client,
    messages,
    model: args.model,
    schema: policyReviewerDecisionSchema,
    schemaName: "policy_reviewer_decision",
  });
}

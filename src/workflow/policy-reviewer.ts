import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

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
} from "../prompts.js";

export type RunPolicyReviewerArgs = {
  client: OpenAI;
  input: TicketInput;
  evidence: TriageEvidence;
  draft: TriageSpecialistDraft;
  model: string;
};

export async function runPolicyReviewer(args: RunPolicyReviewerArgs): Promise<PolicyReviewerDecision> {
  const input = ticketInputSchema.parse(args.input);
  const evidence = triageEvidenceSchema.parse(args.evidence);
  const draft = triageSpecialistDraftSchema.parse(args.draft);
  const response = await args.client.responses.parse({
    model: args.model,
    instructions: buildLocalPolicyReviewerSystemPrompt(),
    input: buildLocalPolicyReviewerUserPrompt(input, evidence, draft),
    text: {
      format: zodTextFormat(policyReviewerDecisionSchema, "policy_reviewer_decision"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("Policy reviewer returned no parsed decision.");
  }

  return policyReviewerDecisionSchema.parse(response.output_parsed);
}

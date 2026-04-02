import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

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
} from "../prompts.js";

export type RunTriageSpecialistArgs = {
  client: OpenAI;
  input: TicketInput;
  evidence: TriageEvidence;
  model: string;
};

export async function runTriageSpecialist(
  args: RunTriageSpecialistArgs,
): Promise<TriageSpecialistDraft> {
  const input = ticketInputSchema.parse(args.input);
  const evidence = triageEvidenceSchema.parse(args.evidence);
  const response = await args.client.responses.parse({
    model: args.model,
    instructions: buildLocalTriageSpecialistSystemPrompt(),
    input: buildLocalTriageSpecialistUserPrompt(input, evidence),
    text: {
      format: zodTextFormat(triageSpecialistDraftSchema, "triage_specialist_draft"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("Triage specialist returned no parsed draft.");
  }

  return triageSpecialistDraftSchema.parse(response.output_parsed);
}

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  policyReviewerDecisionSchema,
  replyWriterOutputSchema,
  ticketInputSchema,
  type ReplyWriterOutput,
  type PolicyReviewerDecision,
  type TicketInput,
} from "../schemas.js";
import {
  buildLocalReplyWriterSystemPrompt,
  buildLocalReplyWriterUserPrompt,
} from "../prompts.js";

export type RunReplyWriterArgs = {
  client: OpenAI;
  input: TicketInput;
  reviewedDecision: PolicyReviewerDecision;
  model: string;
};

export async function runReplyWriter(args: RunReplyWriterArgs): Promise<ReplyWriterOutput> {
  const input = ticketInputSchema.parse(args.input);
  const reviewedDecision = policyReviewerDecisionSchema.parse(args.reviewedDecision);
  const response = await args.client.responses.parse({
    model: args.model,
    instructions: buildLocalReplyWriterSystemPrompt(),
    input: buildLocalReplyWriterUserPrompt(input, reviewedDecision),
    text: {
      format: zodTextFormat(replyWriterOutputSchema, "reply_writer_output"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("Reply writer returned no parsed output.");
  }

  return replyWriterOutputSchema.parse(response.output_parsed);
}

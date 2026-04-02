import { loadPrompt } from "braintrust";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";

import {
  policyReviewerDecisionSchema,
  replyWriterOutputSchema,
  ticketInputSchema,
  type PolicyReviewerDecision,
  type ReplyWriterOutput,
  type TicketInput,
} from "../schemas.js";
import {
  buildLocalReplyWriterSystemPrompt,
  buildLocalReplyWriterUserPrompt,
  buildManagedReplyWriterVariables,
} from "../prompts.js";
import { parseStructuredResponse } from "../openai-responses.js";
import type { ManagedPromptRef, StagePromptMode } from "./triage-specialist.js";

export type RunReplyWriterArgs = {
  client: OpenAI;
  input: TicketInput;
  reviewedDecision: PolicyReviewerDecision;
  model: string;
  promptMode?: StagePromptMode;
  managedPrompt?: ManagedPromptRef;
};

export async function runReplyWriter(args: RunReplyWriterArgs): Promise<ReplyWriterOutput> {
  const input = ticketInputSchema.parse(args.input);
  const reviewedDecision = policyReviewerDecisionSchema.parse(args.reviewedDecision);
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
    const compiled = prompt.build(buildManagedReplyWriterVariables(input, reviewedDecision), {
      flavor: "chat",
    });
    messages = compiled.messages as ChatCompletionMessageParam[];
  } else {
    messages = [
      {
        role: "system",
        content: buildLocalReplyWriterSystemPrompt(),
      },
      {
        role: "user",
        content: buildLocalReplyWriterUserPrompt(input, reviewedDecision),
      },
    ];
  }

  return await parseStructuredResponse({
    client: args.client,
    messages,
    model: args.model,
    schema: replyWriterOutputSchema,
    schemaName: "reply_writer_output",
  });
}

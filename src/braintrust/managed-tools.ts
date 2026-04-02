import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  ParsedResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { zodTextFormat } from "openai/helpers/zod";
import type OpenAI from "openai";
import type { Span } from "braintrust";

import {
  triageEvidenceSchema,
  triageSpecialistDraftSchema,
  type TriageEvidence,
  type TriageSpecialistDraft,
} from "../schemas.js";
import {
  invokeManagedLookupRecentAccountEvents,
  invokeManagedSearchHelpCenter,
  managedToolSlugs,
} from "./tools.js";
import type { ManagedPromptRef } from "../workflow/triage-specialist.js";
import { chatMessagesToResponseInput, chatToolsToResponseTools } from "../openai-responses.js";

type ManagedTriageToolLoopArgs = {
  client: OpenAI;
  managedPrompt: ManagedPromptRef;
  messages: ChatCompletionMessageParam[];
  model: string;
  parentSpan?: Span | null;
  tools: NonNullable<ChatCompletionCreateParamsNonStreaming["tools"]>;
};

export type ManagedTriageToolLoopResult = {
  collectedEvidence: TriageEvidence;
  draft: TriageSpecialistDraft;
};

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === "object") {
    return parsed as Record<string, unknown>;
  }

  throw new Error(`Expected tool arguments to be a JSON object, received ${typeof parsed}.`);
}

async function executeManagedTool(
  args: ManagedTriageToolLoopArgs,
  toolCall: ParsedResponseFunctionToolCall,
  collectedEvidence: TriageEvidence,
): Promise<string> {
  const toolArgs = parseToolArguments(toolCall.arguments);

  if (toolCall.name === managedToolSlugs.searchHelpCenter) {
    const query = typeof toolArgs.query === "string" ? toolArgs.query : "";
    const result = await invokeManagedSearchHelpCenter(args.managedPrompt.projectName, query, args.parentSpan);
    collectedEvidence.help_center_results = result;
    return JSON.stringify(result);
  }

  if (toolCall.name === managedToolSlugs.lookupRecentAccountEvents) {
    const accountId =
      typeof toolArgs.account_id === "string" && toolArgs.account_id.trim() ? toolArgs.account_id : undefined;
    const result = await invokeManagedLookupRecentAccountEvents(
      args.managedPrompt.projectName,
      accountId,
      args.parentSpan,
    );
    collectedEvidence.recent_account_events = result;
    return JSON.stringify(result);
  }

  throw new Error(`Managed triage prompt requested unsupported tool ${toolCall.name}.`);
}

export async function runManagedTriageToolLoop(
  args: ManagedTriageToolLoopArgs,
): Promise<ManagedTriageToolLoopResult> {
  const collectedEvidence = triageEvidenceSchema.parse({
    help_center_results: [],
    recent_account_events: [],
  });
  const tools = chatToolsToResponseTools(args.tools);
  let responseInput: ResponseInputItem[] = chatMessagesToResponseInput(args.messages);
  let previousResponseId: string | undefined;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const response = await args.client.responses.parse({
      model: args.model,
      input: responseInput,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      tools,
      parallel_tool_calls: false,
      text: {
        format: zodTextFormat(triageSpecialistDraftSchema, "triage_specialist_draft"),
      },
    });
    previousResponseId = response.id;
    const toolCalls = response.output.filter(
      (item): item is ParsedResponseFunctionToolCall => item.type === "function_call",
    );

    if (toolCalls.length === 0) {
      if (!response.output_parsed) {
        throw new Error("Managed triage specialist returned no parsed output.");
      }

      return {
        collectedEvidence,
        draft: triageSpecialistDraftSchema.parse(response.output_parsed),
      };
    }

    responseInput = [];
    for (const toolCall of toolCalls) {
      const toolOutput = await executeManagedTool(args, toolCall, collectedEvidence);
      responseInput.push({
        type: "function_call_output",
        call_id: toolCall.call_id,
        output: toolOutput,
      });
    }
  }

  throw new Error("Managed triage specialist exceeded the maximum number of tool-call iterations.");
}

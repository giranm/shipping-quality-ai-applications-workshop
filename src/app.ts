import type { Span } from "braintrust";
import OpenAI from "openai";

import { buildSupportTriageTags, createBraintrustOpenAIClient, withChildSpan } from "./braintrust/tracing.js";
import { type PromptContext } from "./prompts.js";
import { ticketInputSchema, type EscalationResult, type TicketInput, type TriageResult } from "./schemas.js";
import { createEscalation, lookupRecentAccountEvents, searchHelpCenter } from "./tools.js";
import { collectContext } from "./workflow/collect-context.js";
import { finalizeResult } from "./workflow/finalize-result.js";
import { runPolicyReviewer } from "./workflow/policy-reviewer.js";
import { runReplyWriter } from "./workflow/reply-writer.js";
import { runTriageSpecialist } from "./workflow/triage-specialist.js";

export type RunSupportTriageOptions = {
  client?: OpenAI;
  model?: string;
  parentSpan?: Span | null;
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

  return createBraintrustOpenAIClient();
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
  const context = await withChildSpan(
    options.parentSpan,
    {
      name: "collect-context",
      input: {
        account_id: parsedInput.account_id ?? null,
        product_area: parsedInput.product_area ?? null,
      },
      metadata: {
        runtime_mode: "local",
        collection_mode: "local_tools",
      },
      tags: buildSupportTriageTags("runtime_mode:local", "stage:collect-context"),
    },
    async (stageSpan) =>
      collectContext({
        input: parsedInput,
        dependencies: {
          searchHelpCenter: async (query) =>
            withChildSpan(
              stageSpan,
              {
                name: "search-help-center",
                type: "tool",
                input: { query },
                metadata: {
                  runtime_mode: "local",
                  tool_mode: "local",
                },
                tags: buildSupportTriageTags(
                  "runtime_mode:local",
                  "stage:collect-context",
                  "tool:search-help-center",
                ),
              },
              async () => searchHelpCenter(query),
            ),
          lookupRecentAccountEvents: async (accountId) =>
            withChildSpan(
              stageSpan,
              {
                name: "lookup-recent-account-events",
                type: "tool",
                input: {
                  account_id: accountId ?? null,
                },
                metadata: {
                  runtime_mode: "local",
                  tool_mode: "local",
                },
                tags: buildSupportTriageTags(
                  "runtime_mode:local",
                  "stage:collect-context",
                  "tool:lookup-recent-account-events",
                ),
              },
              async () => lookupRecentAccountEvents(accountId),
            ),
        },
      }),
  );
  const triageDraft = await withChildSpan(
    options.parentSpan,
    {
      name: "triage-specialist",
      input: {
        product_area: parsedInput.product_area ?? null,
      },
      metadata: {
        runtime_mode: "local",
        prompt_mode: "local",
      },
      tags: buildSupportTriageTags("runtime_mode:local", "stage:triage-specialist", "prompt_mode:local"),
    },
    async () =>
      runTriageSpecialist({
        client,
        input: parsedInput,
        evidence: context,
        model,
      }),
  );
  const reviewedDecision = await withChildSpan(
    options.parentSpan,
    {
      name: "policy-reviewer",
      input: {
        should_escalate: triageDraft.should_escalate,
        severity: triageDraft.severity,
      },
      metadata: {
        runtime_mode: "local",
        prompt_mode: "local",
      },
      tags: buildSupportTriageTags("runtime_mode:local", "stage:policy-reviewer", "prompt_mode:local"),
    },
    async () =>
      runPolicyReviewer({
        client,
        input: parsedInput,
        evidence: context,
        draft: triageDraft,
        model,
      }),
  );
  const reply = await withChildSpan(
    options.parentSpan,
    {
      name: "reply-writer",
      input: {
        category: reviewedDecision.category,
        severity: reviewedDecision.severity,
      },
      metadata: {
        runtime_mode: "local",
        prompt_mode: "local",
      },
      tags: buildSupportTriageTags("runtime_mode:local", "stage:reply-writer", "prompt_mode:local"),
    },
    async () =>
      runReplyWriter({
        client,
        input: parsedInput,
        reviewedDecision,
        model,
      }),
  );
  const finalized = await withChildSpan(
    options.parentSpan,
    {
      name: "finalize-result",
      metadata: {
        runtime_mode: "local",
        reviewer_action: reviewedDecision.reviewer_action,
      },
      tags: buildSupportTriageTags("runtime_mode:local", "stage:finalize-result"),
    },
    async (stageSpan) =>
      finalizeResult({
        reviewedDecision,
        reply,
        dependencies: {
          createEscalation: async (reason) =>
            withChildSpan(
              stageSpan,
              {
                name: "create-escalation",
                type: "tool",
                input: { reason },
                metadata: {
                  runtime_mode: "local",
                  tool_mode: "local",
                },
                tags: buildSupportTriageTags(
                  "runtime_mode:local",
                  "stage:finalize-result",
                  "tool:create-escalation",
                ),
              },
              async () => createEscalation(reason),
            ),
        },
      }),
  );

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

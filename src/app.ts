import type { Span } from "braintrust";
import OpenAI from "openai";

import { getBraintrustProjectName, requireBraintrustProjectName } from "./braintrust/config.js";
import { loadHelprRuntimeParameters } from "./braintrust/parameters.js";
import { managedPromptSlugs } from "./braintrust/prompts.js";
import { buildSupportTriageTags, createBraintrustOpenAIClient, withChildSpan } from "./braintrust/tracing.js";
import { type PromptContext } from "./prompts.js";
import { ticketInputSchema, type EscalationResult, type TicketInput, type TriageResult } from "./schemas.js";
import { createEscalation, lookupRecentAccountEvents, searchHelpCenter } from "./tools.js";
import { collectContext } from "./workflow/collect-context.js";
import { finalizeResult } from "./workflow/finalize-result.js";
import { runPolicyReviewer } from "./workflow/policy-reviewer.js";
import { runReplyWriter } from "./workflow/reply-writer.js";
import {
  type ManagedPromptRef,
  runTriageSpecialist,
  type StagePromptMode,
} from "./workflow/triage-specialist.js";

export type RuntimeMode = "local" | "managed";

export type RunSupportTriageOptions = {
  client?: OpenAI;
  model?: string;
  runtimeMode?: RuntimeMode;
  parentSpan?: Span | null;
};

type StageName = "triage_specialist" | "policy_reviewer" | "reply_writer";

type StagePromptConfig = {
  promptMode: StagePromptMode;
  managedPrompt?: ManagedPromptRef;
};

type StagePromptConfigMap = Record<StageName, StagePromptConfig>;

type RuntimeSettings = {
  model: string;
};

export type SupportTriageRun = {
  input: TicketInput;
  context: PromptContext & {
    runtime_mode: RuntimeMode;
    stage_prompt_modes: Record<StageName, StagePromptMode>;
  };
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

export function getRuntimeMode(runtimeMode?: RuntimeMode): RuntimeMode {
  return runtimeMode ?? ((process.env.RUNTIME_MODE as RuntimeMode | undefined) ?? "local");
}

function buildManagedPromptRef(slug?: string): ManagedPromptRef | undefined {
  const projectName = getBraintrustProjectName();

  if (!slug || !projectName) {
    return undefined;
  }

  return {
    projectName,
    slug,
    apiKey: process.env.BRAINTRUST_API_KEY,
  };
}

function buildStagePromptConfigs(runtimeMode: RuntimeMode): StagePromptConfigMap {
  if (runtimeMode === "local") {
    return {
      triage_specialist: { promptMode: "local" },
      policy_reviewer: { promptMode: "local" },
      reply_writer: { promptMode: "local" },
    };
  }

  requireBraintrustProjectName();

  const triagePrompt = buildManagedPromptRef(managedPromptSlugs.triageSpecialist);
  const policyPrompt = buildManagedPromptRef(managedPromptSlugs.policyReviewer);
  const replyPrompt = buildManagedPromptRef(managedPromptSlugs.replyWriter);

  if (!triagePrompt || !policyPrompt || !replyPrompt) {
    throw new Error("Managed prompt slugs require BRAINTRUST_PROJECT when RUNTIME_MODE=managed.");
  }

  return {
    triage_specialist: {
      promptMode: "managed",
      managedPrompt: triagePrompt,
    },
    policy_reviewer: {
      promptMode: "managed",
      managedPrompt: policyPrompt,
    },
    reply_writer: {
      promptMode: "managed",
      managedPrompt: replyPrompt,
    },
  };
}

function summarizeStagePromptModes(stagePromptConfigs: StagePromptConfigMap): Record<StageName, StagePromptMode> {
  return {
    triage_specialist: stagePromptConfigs.triage_specialist.promptMode,
    policy_reviewer: stagePromptConfigs.policy_reviewer.promptMode,
    reply_writer: stagePromptConfigs.reply_writer.promptMode,
  };
}

async function resolveRuntimeSettings(
  runtimeMode: RuntimeMode,
  options: RunSupportTriageOptions,
): Promise<RuntimeSettings> {
  if (runtimeMode !== "managed") {
    return {
      model: getModel(options.model),
    };
  }

  const projectName = requireBraintrustProjectName();
  const parameters = await loadHelprRuntimeParameters(projectName, process.env.BRAINTRUST_API_KEY);

  return {
    model: options.model ?? parameters.model ?? getModel(),
  };
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
  const runtimeMode = getRuntimeMode(options.runtimeMode);
  const stagePromptConfigs = buildStagePromptConfigs(runtimeMode);
  const stagePromptModes = summarizeStagePromptModes(stagePromptConfigs);
  const runtimeSettings = await resolveRuntimeSettings(runtimeMode, options);

  const context = await withChildSpan(
    options.parentSpan,
    {
      name: "collect-context",
      input: {
        account_id: parsedInput.account_id ?? null,
        product_area: parsedInput.product_area ?? null,
      },
      metadata: {
        runtime_mode: runtimeMode,
        collection_mode: "local_tools",
      },
      tags: buildSupportTriageTags(`runtime_mode:${runtimeMode}`, "stage:collect-context"),
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
                  runtime_mode: runtimeMode,
                  tool_mode: "local",
                },
                tags: buildSupportTriageTags(
                  `runtime_mode:${runtimeMode}`,
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
                  runtime_mode: runtimeMode,
                  tool_mode: "local",
                },
                tags: buildSupportTriageTags(
                  `runtime_mode:${runtimeMode}`,
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
        runtime_mode: runtimeMode,
        prompt_mode: stagePromptModes.triage_specialist,
      },
      tags: buildSupportTriageTags(
        `runtime_mode:${runtimeMode}`,
        "stage:triage-specialist",
        `prompt_mode:${stagePromptModes.triage_specialist}`,
      ),
    },
    async () =>
      runTriageSpecialist({
        client,
        input: parsedInput,
        evidence: context,
        model: runtimeSettings.model,
        ...stagePromptConfigs.triage_specialist,
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
        runtime_mode: runtimeMode,
        prompt_mode: stagePromptModes.policy_reviewer,
      },
      tags: buildSupportTriageTags(
        `runtime_mode:${runtimeMode}`,
        "stage:policy-reviewer",
        `prompt_mode:${stagePromptModes.policy_reviewer}`,
      ),
    },
    async () =>
      runPolicyReviewer({
        client,
        input: parsedInput,
        evidence: context,
        draft: triageDraft,
        model: runtimeSettings.model,
        ...stagePromptConfigs.policy_reviewer,
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
        runtime_mode: runtimeMode,
        prompt_mode: stagePromptModes.reply_writer,
      },
      tags: buildSupportTriageTags(
        `runtime_mode:${runtimeMode}`,
        "stage:reply-writer",
        `prompt_mode:${stagePromptModes.reply_writer}`,
      ),
    },
    async () =>
      runReplyWriter({
        client,
        input: parsedInput,
        reviewedDecision,
        model: runtimeSettings.model,
        ...stagePromptConfigs.reply_writer,
      }),
  );
  const finalized = await withChildSpan(
    options.parentSpan,
    {
      name: "finalize-result",
      metadata: {
        runtime_mode: runtimeMode,
        reviewer_action: reviewedDecision.reviewer_action,
      },
      tags: buildSupportTriageTags(`runtime_mode:${runtimeMode}`, "stage:finalize-result"),
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
                  runtime_mode: runtimeMode,
                  tool_mode: "local",
                },
                tags: buildSupportTriageTags(
                  `runtime_mode:${runtimeMode}`,
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
    context: {
      ...context,
      runtime_mode: runtimeMode,
      stage_prompt_modes: stagePromptModes,
    },
    stages: {
      triage_specialist: triageDraft,
      policy_reviewer: reviewedDecision,
      reply_writer: reply,
    },
    escalation: finalized.escalation,
    result: finalized.result,
  };
}

import type { Span } from "braintrust";
import OpenAI from "openai";

import { getBraintrustProjectName, requireBraintrustProjectName } from "./braintrust/config.js";
import { loadHelprRuntimeParameters } from "./braintrust/parameters.js";
import { managedPromptSlugs } from "./braintrust/prompts.js";
import { invokeManagedCreateEscalation } from "./braintrust/tools.js";
import {
  type PolicyReviewerDecision,
  type ReplyWriterOutput,
  ticketInputSchema,
  type TicketInput,
  type TriageEvidence,
  type TriageSpecialistDraft,
  type TriageResult,
} from "./schemas.js";
import { createBraintrustOpenAIClient, withChildSpan } from "./braintrust/tracing.js";
import {
  createEscalation,
  lookupRecentAccountEvents,
  searchHelpCenter,
  type EscalationResult,
} from "./tools.js";
import { collectContext } from "./workflow/collect-context.js";
import { finalizeResult } from "./workflow/finalize-result.js";
import { runPolicyReviewer } from "./workflow/policy-reviewer.js";
import { runReplyWriter } from "./workflow/reply-writer.js";
import {
  runTriageSpecialist,
  type ManagedPromptRef,
  type StagePromptMode,
} from "./workflow/triage-specialist.js";

export type RuntimeMode = "local" | "managed";
export type RunSupportTriageOptions = {
  client?: OpenAI;
  model?: string;
  runtimeMode?: RuntimeMode;
  parentSpan?: Span | null;
};

function getModel(model?: string): string {
  return model ?? process.env.OPENAI_MODEL ?? "gpt-5-mini";
}

function getRuntimeMode(runtimeMode?: RuntimeMode): RuntimeMode {
  return runtimeMode ?? ((process.env.RUNTIME_MODE as RuntimeMode | undefined) ?? "local");
}

function createClient(client?: OpenAI): OpenAI {
  if (client) {
    return client;
  }

  return createBraintrustOpenAIClient();
}

type StageName = "triage_specialist" | "policy_reviewer" | "reply_writer";

type StagePromptConfig = {
  promptMode: StagePromptMode;
  managedPrompt?: ManagedPromptRef;
};

type StagePromptConfigMap = Record<StageName, StagePromptConfig>;

type RuntimeSettings = {
  model: string;
};

type SupportTriageStages = {
  triage_specialist: TriageSpecialistDraft;
  policy_reviewer: PolicyReviewerDecision;
  reply_writer: ReplyWriterOutput;
};

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
  if (!triagePrompt) {
    throw new Error("Managed prompt slugs require BRAINTRUST_PROJECT when RUNTIME_MODE=managed.");
  }

  const policyPrompt = buildManagedPromptRef(managedPromptSlugs.policyReviewer);
  const replyPrompt = buildManagedPromptRef(managedPromptSlugs.replyWriter);

  return {
    triage_specialist: {
      promptMode: "managed",
      managedPrompt: triagePrompt,
    },
    policy_reviewer: policyPrompt
      ? {
          promptMode: "managed",
          managedPrompt: policyPrompt,
        }
      : {
          promptMode: "local",
        },
    reply_writer: replyPrompt
      ? {
          promptMode: "managed",
          managedPrompt: replyPrompt,
        }
      : {
          promptMode: "local",
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

async function runCollectContextStage(
  input: TicketInput,
  runtimeMode: RuntimeMode,
  parentSpan?: Span | null,
): Promise<TriageEvidence> {
  if (runtimeMode === "managed") {
    return withChildSpan(
      parentSpan,
      {
        name: "collect-context",
        metadata: {
          strategy: "deferred_to_managed_triage_tools",
        },
      },
      async () => ({
        help_center_results: [],
        recent_account_events: [],
      }),
    );
  }

  return withChildSpan(
    parentSpan,
    {
      name: "collect-context",
      input: {
        account_id: input.account_id ?? null,
        product_area: input.product_area ?? null,
      },
    },
    async (stageSpan) =>
      collectContext({
        input,
        dependencies: {
          searchHelpCenter: async (query) =>
            withChildSpan(
              stageSpan,
              {
                name: "search-help-center",
                type: "tool",
                input: { query },
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
              },
              async () => lookupRecentAccountEvents(accountId),
            ),
        },
      }),
  );
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

export type SupportTriageRun = {
  input: TicketInput;
  context: TriageEvidence & {
    escalation: EscalationResult | null;
    runtime_mode: RuntimeMode;
    reviewer_overrode_draft: boolean;
    stage_prompt_modes: Record<StageName, StagePromptMode>;
  };
  stages: SupportTriageStages;
  result: TriageResult;
};

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

  const context = await runCollectContextStage(parsedInput, runtimeMode, options.parentSpan);
  const triageSpecialist = await withChildSpan(
    options.parentSpan,
    {
      name: "triage-specialist",
      metadata: {
        prompt_mode: stagePromptModes.triage_specialist,
      },
    },
    async () =>
      runTriageSpecialist({
        client,
        input: parsedInput,
        evidence: context,
        model: runtimeSettings.model,
        parentSpan: options.parentSpan,
        ...stagePromptConfigs.triage_specialist,
      }),
  );
  const effectiveEvidence =
    runtimeMode === "managed" &&
    (triageSpecialist.collectedEvidence.help_center_results.length > 0 ||
      triageSpecialist.collectedEvidence.recent_account_events.length > 0)
      ? triageSpecialist.collectedEvidence
      : context;
  const policyReviewer = await withChildSpan(
    options.parentSpan,
    {
      name: "policy-reviewer",
      metadata: {
        prompt_mode: stagePromptModes.policy_reviewer,
      },
    },
    async () =>
      runPolicyReviewer({
        client,
        input: parsedInput,
        evidence: effectiveEvidence,
        draft: triageSpecialist.draft,
        model: runtimeSettings.model,
        ...stagePromptConfigs.policy_reviewer,
      }),
  );
  const replyWriter = await withChildSpan(
    options.parentSpan,
    {
      name: "reply-writer",
      metadata: {
        prompt_mode: stagePromptModes.reply_writer,
      },
    },
    async () =>
      runReplyWriter({
        client,
        input: parsedInput,
        reviewedDecision: policyReviewer,
        model: runtimeSettings.model,
        ...stagePromptConfigs.reply_writer,
      }),
  );
  const finalized = await withChildSpan(
    options.parentSpan,
    {
      name: "finalize-result",
      metadata: {
        reviewer_action: policyReviewer.reviewer_action,
      },
    },
    async (stageSpan) => {
      const result = finalizeResult({
        reviewedDecision: policyReviewer,
        reply: replyWriter,
      });
      let escalation: EscalationResult | null = null;

      if (result.should_escalate) {
        const reason = result.escalation_reason.trim() || result.recommended_action;
        escalation = await withChildSpan(
          stageSpan,
          {
            name: "create-escalation",
            type: "tool",
            input: {
              reason,
            },
          },
          async () =>
            runtimeMode === "managed"
              ? invokeManagedCreateEscalation(requireBraintrustProjectName(), reason, stageSpan)
              : createEscalation(reason),
        );
      }

      return {
        result,
        escalation,
      };
    },
  );

  return {
    input: parsedInput,
    context: {
      ...effectiveEvidence,
      escalation: finalized.escalation,
      runtime_mode: runtimeMode,
      reviewer_overrode_draft: policyReviewer.reviewer_action === "revised",
      stage_prompt_modes: stagePromptModes,
    },
    stages: {
      triage_specialist: triageSpecialist.draft,
      policy_reviewer: policyReviewer,
      reply_writer: replyWriter,
    },
    result: finalized.result,
  };
}

export async function runSupportTriage(
  input: TicketInput,
  options: RunSupportTriageOptions = {},
): Promise<TriageResult> {
  return (await runSupportTriageDetailed(input, options)).result;
}

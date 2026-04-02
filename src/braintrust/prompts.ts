import { projects } from "braintrust";

import { ensureBraintrustProject, type BraintrustIfExists } from "./api.js";
import { runtimeParametersSlug } from "./parameters.js";
import { remoteScorerSlugs } from "./remote-scorers.js";
import { buildManagedPromptToolDefinitions } from "./tools.js";
import {
  buildLocalPolicyReviewerSystemPrompt,
  buildLocalReplyWriterSystemPrompt,
  buildLocalTriageSpecialistSystemPrompt,
  buildManagedPolicyReviewerUserTemplate,
  buildManagedReplyWriterUserTemplate,
  buildManagedTriageSpecialistUserTemplate,
} from "../prompts.js";

export type BraintrustPromptBootstrapConfig = {
  projectName: string;
  ifExists?: BraintrustIfExists;
  model?: string;
};

export const managedPromptSlugs = {
  triageSpecialist: "helpr-triage-specialist",
  policyReviewer: "helpr-policy-reviewer",
  replyWriter: "helpr-reply-writer",
} as const;

type PromptSpec = {
  name: string;
  slug: string;
  description: string;
  tags: string[];
  metadata: Record<string, unknown>;
  messages: { role: "system" | "user"; content: string }[];
  tools?: ReturnType<typeof buildManagedPromptToolDefinitions>;
};

export type BraintrustPromptBootstrapResult = {
  dryRun: boolean;
  ifExists: BraintrustIfExists;
  model: string;
  projectName: string;
  projectId?: string;
  prompts: Array<{
    description: string;
    name: string;
    slug: string;
  }>;
};

function buildPromptSpecs(config: BraintrustPromptBootstrapConfig): PromptSpec[] {
  return [
    {
      name: "Helpr Triage Specialist",
      slug: managedPromptSlugs.triageSpecialist,
      description:
        "Baseline managed prompt for the triage specialist stage. Published model follows helpr-runtime-config.model. Uses managed tools helpr-search-help-center and helpr-lookup-recent-account-events.",
      tags: [
        "helpr",
        "managed",
        "prompt",
        "stage:triage-specialist",
        `uses:param:${runtimeParametersSlug}`,
        "uses:tool:helpr-search-help-center",
        "uses:tool:helpr-lookup-recent-account-events",
      ],
      metadata: {
        component: "helpr",
        object_role: "managed_prompt",
        stage: "triage-specialist",
        managed_by: "make setup-braintrust",
        runtime_parameter_slugs: [runtimeParametersSlug],
        runtime_parameter_fields: ["model"],
        published_model_source: `${runtimeParametersSlug}.model`,
        related_tool_slugs: ["helpr-search-help-center", "helpr-lookup-recent-account-events"],
        related_scorer_slugs: [remoteScorerSlugs.rootTriageQualityJudge, remoteScorerSlugs.stageOutputPresent],
      },
      tools: buildManagedPromptToolDefinitions(),
      messages: [
        {
          role: "system",
          content: buildLocalTriageSpecialistSystemPrompt(),
        },
        {
          role: "user",
          content: buildManagedTriageSpecialistUserTemplate(),
        },
      ],
    },
    {
      name: "Helpr Policy Reviewer",
      slug: managedPromptSlugs.policyReviewer,
      description:
        "Baseline managed prompt for the policy reviewer stage. Published model follows helpr-runtime-config.model.",
      tags: [
        "helpr",
        "managed",
        "prompt",
        "stage:policy-reviewer",
        `uses:param:${runtimeParametersSlug}`,
      ],
      metadata: {
        component: "helpr",
        object_role: "managed_prompt",
        stage: "policy-reviewer",
        managed_by: "make setup-braintrust",
        runtime_parameter_slugs: [runtimeParametersSlug],
        runtime_parameter_fields: ["model"],
        published_model_source: `${runtimeParametersSlug}.model`,
        related_scorer_slugs: [remoteScorerSlugs.stageOutputPresent],
      },
      messages: [
        {
          role: "system",
          content: buildLocalPolicyReviewerSystemPrompt(),
        },
        {
          role: "user",
          content: buildManagedPolicyReviewerUserTemplate(),
        },
      ],
    },
    {
      name: "Helpr Reply Writer",
      slug: managedPromptSlugs.replyWriter,
      description:
        "Baseline managed prompt for the reply writer stage. Published model follows helpr-runtime-config.model.",
      tags: [
        "helpr",
        "managed",
        "prompt",
        "stage:reply-writer",
        `uses:param:${runtimeParametersSlug}`,
      ],
      metadata: {
        component: "helpr",
        object_role: "managed_prompt",
        stage: "reply-writer",
        managed_by: "make setup-braintrust",
        runtime_parameter_slugs: [runtimeParametersSlug],
        runtime_parameter_fields: ["model"],
        published_model_source: `${runtimeParametersSlug}.model`,
        related_scorer_slugs: [remoteScorerSlugs.customerReplyRubric, remoteScorerSlugs.replyToneClassifier],
      },
      messages: [
        {
          role: "system",
          content: buildLocalReplyWriterSystemPrompt(),
        },
        {
          role: "user",
          content: buildManagedReplyWriterUserTemplate(),
        },
      ],
    },
  ];
}

export async function setupBraintrustPrompts(
  config: BraintrustPromptBootstrapConfig,
  options?: { dryRun?: boolean; onLog?: (line: string) => void },
): Promise<BraintrustPromptBootstrapResult> {
  const ifExists = config.ifExists ?? "ignore";
  const model = config.model ?? "gpt-5-mini";
  const promptSpecs = buildPromptSpecs(config);

  const result: BraintrustPromptBootstrapResult = {
    dryRun: options?.dryRun ?? false,
    ifExists,
    model,
    projectName: config.projectName,
    prompts: promptSpecs.map((prompt) => ({
      description: prompt.description,
      name: prompt.name,
      slug: prompt.slug,
    })),
  };

  if (options?.dryRun) {
    options.onLog?.(`Preflight: would ensure Braintrust project "${config.projectName}" exists.`);
    options.onLog?.(
      `Preflight: would publish ${promptSpecs.length} prompt(s) with ifExists=${ifExists} and model=${model}.`,
    );

    return result;
  }

  options?.onLog?.(`Preflight: ensuring Braintrust project "${config.projectName}" exists...`);
  const projectId = await ensureBraintrustProject(config.projectName);
  result.projectId = projectId;
  options?.onLog?.(`Preflight: using Braintrust project "${config.projectName}" (${projectId}).`);

  const project = projects.create({ name: config.projectName });

  options?.onLog?.(
    `Publish: creating ${promptSpecs.length} prompt definition(s) with ifExists=${ifExists} and model=${model}.`,
  );

  for (const prompt of promptSpecs) {
    options?.onLog?.(`Publish: queueing prompt ${prompt.slug}.`);
    project.prompts.create({
      name: prompt.name,
      slug: prompt.slug,
      description: prompt.description,
      tags: prompt.tags,
      metadata: prompt.metadata,
      messages: prompt.messages,
      ...(prompt.tools ? { tools: prompt.tools } : {}),
      ifExists,
      model,
    });
  }

  await project.publish();
  options?.onLog?.(`Publish: completed for project "${config.projectName}".`);

  return result;
}

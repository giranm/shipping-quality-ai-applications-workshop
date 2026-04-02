import { projects } from "braintrust";

import { ensureBraintrustProject, type BraintrustIfExists } from "./api.js";
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
  messages: { role: "system" | "user"; content: string }[];
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

function buildPromptSpecs(): PromptSpec[] {
  return [
    {
      name: "Helpr Triage Specialist",
      slug: managedPromptSlugs.triageSpecialist,
      description: "Managed prompt for the triage specialist stage.",
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
      description: "Managed prompt for the policy reviewer stage.",
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
      description: "Managed prompt for the reply writer stage.",
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
  const promptSpecs = buildPromptSpecs();

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

  result.projectId = await ensureBraintrustProject(config.projectName);
  const project = projects.create({ name: config.projectName });

  for (const prompt of promptSpecs) {
    project.prompts.create({
      name: prompt.name,
      slug: prompt.slug,
      description: prompt.description,
      messages: prompt.messages,
      ifExists,
      model,
    });
  }

  await project.publish();

  return result;
}

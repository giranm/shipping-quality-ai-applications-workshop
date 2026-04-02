import { projects } from "braintrust";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { z } from "zod/v3";

import type { TriageResult } from "../schemas.js";
import type { BraintrustIfExists } from "./api.js";
import { ensureBraintrustProject } from "./api.js";
import { runtimeParametersSlug } from "./parameters.js";
import {
  scoreCategoryExact,
  scoreConfidenceInRange,
  scoreConflictingSignalsActionable,
  scoreEnterpriseBlockedNotLow,
  scoreEscalationExact,
  scoreEscalationReasonPresent,
  scoreLowContextConfidenceCap,
  scoreReplyRubric,
  scoreRequiredFieldsPresent,
  scoreReviewerOverrideGuardrail,
  scoreSchemaValidity,
  scoreSeverityExact,
  scoreStageOutputPresent,
} from "./scorer-logic.js";

type BraintrustProject = ReturnType<typeof projects.create>;
const PUSH_PROJECT_NAME_PLACEHOLDER = "\"__BRAINTRUST_PROJECT_NAME__\"";
type RemoteScorerArgs = {
  expected?: Partial<TriageResult> | undefined;
  input?: unknown;
  metadata?: Record<string, unknown>;
  output: unknown;
};

type RemoteScorerKind = "code" | "llm";

type RemoteScorerRegistration = {
  description: string;
  kind: RemoteScorerKind;
  name: string;
  onlineEligible: boolean;
  register(project: BraintrustProject, options: { ifExists: BraintrustIfExists; model: string }): void;
  slug: string;
};

type RemoteScorerValue = {
  metadata?: Record<string, unknown>;
  score: number;
};

function getRemoteScorerRegistrations(): RemoteScorerRegistration[] {
  return buildRemoteScorerRegistrations();
}

function buildNamedScore(name: string, value: RemoteScorerValue): { name: string; score: number; metadata?: Record<string, unknown> } {
  return {
    name,
    score: value.score,
    ...(value.metadata ? { metadata: value.metadata } : {}),
  };
}

export const remoteScorerSlugs = {
  categoryExact: "helpr-category-exact",
  confidenceInRange: "helpr-confidence-in-range",
  conflictingSignalsActionable: "helpr-conflicting-signals-actionable",
  customerReplyRubric: "helpr-customer-reply-rubric",
  enterpriseBlockedNotLow: "helpr-enterprise-blocked-not-low",
  escalationExact: "helpr-escalation-exact",
  escalationReasonPresent: "helpr-escalation-reason-present",
  lowContextConfidenceCap: "helpr-low-context-confidence-cap",
  replyActionability: "helpr-reply-actionability",
  replyAvoidOverpromising: "helpr-reply-avoid-overpromising",
  replyCorrectness: "helpr-reply-correctness",
  replyEmpathy: "helpr-reply-empathy",
  replyToneClassifier: "helpr-reply-tone-classifier",
  requiredFieldsPresent: "helpr-required-fields-present",
  reviewerOverrideGuardrail: "helpr-reviewer-override-guardrail",
  rootTriageQualityJudge: "helpr-root-triage-quality-judge",
  schemaValid: "helpr-schema-valid",
  severityExact: "helpr-severity-exact",
  stageOutputPresent: "helpr-stage-output-present",
} as const;

export type RemoteScorerSlug = (typeof remoteScorerSlugs)[keyof typeof remoteScorerSlugs];

export type BraintrustScorerBootstrapConfig = {
  ifExists?: BraintrustIfExists;
  model?: string;
  projectName: string;
};

export type BraintrustScorerBootstrapResult = {
  dryRun: boolean;
  ifExists: BraintrustIfExists;
  model: string;
  projectId?: string;
  projectName: string;
  scorers: Array<{
    description: string;
    kind: RemoteScorerKind;
    name: string;
    onlineEligible: boolean;
    slug: string;
  }>;
};

function buildRemoteScorerRegistrations(): RemoteScorerRegistration[] {
  const buildScorerTags = (kind: RemoteScorerKind, onlineEligible: boolean, extraTags: string[] = []): string[] => [
    "helpr",
    "managed",
    "scorer",
    `kind:${kind}`,
    onlineEligible ? "scope:online" : "scope:offline",
    ...extraTags,
  ];

  const buildScorerMetadata = (
    kind: RemoteScorerKind,
    onlineEligible: boolean,
    slug: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    component: "helpr",
    object_role: "managed_scorer",
    scorer_kind: kind,
    scorer_slug: slug,
    online_eligible: onlineEligible,
    managed_by: "make setup-braintrust",
    ...extra,
  });

  const codeScorer = (
    name: string,
    slug: string,
    description: string,
    onlineEligible: boolean,
    handler: (args: RemoteScorerArgs) => unknown,
    extra?: { metadata?: Record<string, unknown>; tags?: string[] },
  ): RemoteScorerRegistration => ({
    name,
    slug,
    description,
    kind: "code",
    onlineEligible,
    register(project, options) {
      project.scorers.create({
        name,
        slug,
        description,
        ifExists: options.ifExists,
        tags: buildScorerTags("code", onlineEligible, extra?.tags),
        metadata: buildScorerMetadata("code", onlineEligible, slug, extra?.metadata),
        handler,
      });
    },
  });

  const llmScorer = (
    name: string,
    slug: string,
    description: string,
    messages: Array<{ role: "system" | "user"; content: string }>,
    choiceScores: Record<string, number>,
    useCot: boolean,
    parameters?: z.ZodTypeAny,
    extra?: { metadata?: Record<string, unknown>; tags?: string[] },
  ): RemoteScorerRegistration => ({
    name,
    slug,
    description,
    kind: "llm",
    onlineEligible: true,
    register(project, options) {
      project.scorers.create({
        name,
        slug,
        description,
        ifExists: options.ifExists,
        messages,
        model: options.model,
        useCot,
        choiceScores,
        tags: buildScorerTags("llm", true, extra?.tags),
        metadata: buildScorerMetadata("llm", true, slug, extra?.metadata),
        ...(parameters ? { parameters } : {}),
      });
    },
  });

  return [
    codeScorer(
      "Helpr Category Exact",
      remoteScorerSlugs.categoryExact,
      "Exact-match scorer for category labels when expected values are present.",
      false,
      ({ output, expected }: RemoteScorerArgs) =>
        buildNamedScore("category_exact", scoreCategoryExact({ output, expected })),
    ),
    codeScorer(
      "Helpr Severity Exact",
      remoteScorerSlugs.severityExact,
      "Exact-match scorer for severity labels when expected values are present.",
      false,
      ({ output, expected }: RemoteScorerArgs) =>
        buildNamedScore("severity_exact", scoreSeverityExact({ output, expected })),
    ),
    codeScorer(
      "Helpr Escalation Exact",
      remoteScorerSlugs.escalationExact,
      "Exact-match scorer for escalation decisions when expected values are present.",
      false,
      ({ output, expected }: RemoteScorerArgs) =>
        buildNamedScore("escalation_exact", scoreEscalationExact({ output, expected })),
    ),
    codeScorer(
      "Helpr Schema Valid",
      remoteScorerSlugs.schemaValid,
      "Checks whether the final triage result is structurally valid.",
      true,
      ({ output }: RemoteScorerArgs) => buildNamedScore("schema_valid", scoreSchemaValidity({ output })),
    ),
    codeScorer(
      "Helpr Required Fields Present",
      remoteScorerSlugs.requiredFieldsPresent,
      "Checks whether required result fields are present and non-empty.",
      true,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("required_fields_present", scoreRequiredFieldsPresent({ output })),
    ),
    codeScorer(
      "Helpr Escalation Reason Present",
      remoteScorerSlugs.escalationReasonPresent,
      "Checks whether escalated outcomes include an escalation reason.",
      true,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("escalation_reason_present", scoreEscalationReasonPresent({ output })),
    ),
    codeScorer(
      "Helpr Enterprise Blocked Not Low",
      remoteScorerSlugs.enterpriseBlockedNotLow,
      "Flags low severity on obviously blocked enterprise issues.",
      true,
      ({ input, output }: RemoteScorerArgs) =>
        buildNamedScore("enterprise_blocked_not_low", scoreEnterpriseBlockedNotLow({ input, output })),
    ),
    codeScorer(
      "Helpr Confidence In Range",
      remoteScorerSlugs.confidenceInRange,
      "Checks whether confidence remains between 0 and 1.",
      true,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("confidence_in_range", scoreConfidenceInRange({ output })),
    ),
    codeScorer(
      "Helpr Reviewer Override Guardrail",
      remoteScorerSlugs.reviewerOverrideGuardrail,
      "Eval-only guardrail for cases where reviewer override is expected.",
      false,
      ({ output, metadata }: RemoteScorerArgs) =>
        buildNamedScore("reviewer_override_guardrail", scoreReviewerOverrideGuardrail({ output, metadata })),
    ),
    codeScorer(
      "Helpr Conflicting Signals Actionable",
      remoteScorerSlugs.conflictingSignalsActionable,
      "Eval-only guardrail for cases with conflicting evidence.",
      false,
      ({ output, metadata }: RemoteScorerArgs) =>
        buildNamedScore("conflicting_signals_actionable", scoreConflictingSignalsActionable({ output, metadata })),
    ),
    codeScorer(
      "Helpr Low Context Confidence Cap",
      remoteScorerSlugs.lowContextConfidenceCap,
      "Checks that vague or low-context tickets do not receive overconfident scores.",
      true,
      ({ input, output, metadata }: RemoteScorerArgs) =>
        buildNamedScore("low_context_confidence_cap", scoreLowContextConfidenceCap({ input, output, metadata })),
    ),
    codeScorer(
      "Helpr Reply Empathy",
      remoteScorerSlugs.replyEmpathy,
      "Heuristic reply empathy scorer.",
      false,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("reply_empathy", scoreReplyRubric({ output }).reply_empathy),
    ),
    codeScorer(
      "Helpr Reply Actionability",
      remoteScorerSlugs.replyActionability,
      "Heuristic reply actionability scorer.",
      false,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("reply_actionability", scoreReplyRubric({ output }).reply_actionability),
    ),
    codeScorer(
      "Helpr Reply Avoid Overpromising",
      remoteScorerSlugs.replyAvoidOverpromising,
      "Heuristic reply overpromising guardrail.",
      false,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("reply_avoid_overpromising", scoreReplyRubric({ output }).reply_avoid_overpromising),
    ),
    codeScorer(
      "Helpr Reply Correctness",
      remoteScorerSlugs.replyCorrectness,
      "Heuristic reply correctness scorer.",
      false,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("reply_correctness", scoreReplyRubric({ output }).reply_correctness),
    ),
    codeScorer(
      "Helpr Customer Reply Rubric",
      remoteScorerSlugs.customerReplyRubric,
      "Composite heuristic scorer for support reply quality.",
      true,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("customer_reply_rubric", scoreReplyRubric({ output }).customer_reply_rubric),
    ),
    codeScorer(
      "Helpr Stage Output Present",
      remoteScorerSlugs.stageOutputPresent,
      "Checks whether specialist stage spans emitted a structured output.",
      true,
      ({ output }: RemoteScorerArgs) =>
        buildNamedScore("stage_output_present", scoreStageOutputPresent({ output })),
    ),
    llmScorer(
      "Helpr Root Triage Quality Judge",
      remoteScorerSlugs.rootTriageQualityJudge,
      "LLM judge for overall triage quality on the full request trace. Published model follows helpr-runtime-config.model.",
      [
        {
          role: "system",
          content:
            "You evaluate the quality of a staged support triage run. Judge whether the final result is proportionate, well-calibrated, and operationally useful. Return only one label: excellent, good, mixed, or poor.",
        },
        {
          role: "user",
          content: [
            "Support ticket input:",
            "{{input}}",
            "",
            "Root output:",
            "{{output}}",
            "",
            "Full trace thread:",
            "{{thread}}",
            "",
            "Judge the overall outcome on these criteria:",
            "- category, severity, and escalation are appropriate for the ticket",
            "- the recommended action is concrete and proportionate",
            "- the system avoids obvious overreaction or underreaction",
            "- the final customer reply is directionally appropriate",
            "",
            'Return exactly one of: "excellent", "good", "mixed", or "poor".',
          ].join("\n"),
        },
      ],
      {
        excellent: 1,
        good: 0.85,
        mixed: 0.5,
        poor: 0,
      },
      true,
      z.object({
        input: z.any().optional(),
        output: z.any().optional(),
        trace: z.any().optional(),
      }),
      {
        tags: [`uses:param:${runtimeParametersSlug}`, "span:root"],
        metadata: {
          runtime_parameter_slugs: [runtimeParametersSlug],
          runtime_parameter_fields: ["model"],
          published_model_source: `${runtimeParametersSlug}.model`,
          related_parameter_slug: runtimeParametersSlug,
          evaluates_span_names: ["support-triage-demo", "support-triage-manual", "replay-prod-failure", "support-triage-online-verify"],
        },
      },
    ),
    llmScorer(
      "Helpr Reply Tone Classifier",
      remoteScorerSlugs.replyToneClassifier,
      "LLM judge for reply tone, clarity, and overpromising risk on reply-writer spans. Published model follows helpr-runtime-config.model.",
      [
        {
          role: "system",
          content:
            "You classify customer support replies. Return only one label: good, needs_work, or unsafe_or_overpromising.",
        },
        {
          role: "user",
          content: [
            "Reply output:",
            "{{output}}",
            "",
            "Evaluate the reply on these criteria:",
            "- concise and easy to follow",
            "- calm and helpful tone",
            "- does not overpromise or sound alarmist",
            "",
            'Return exactly one of: "good", "needs_work", or "unsafe_or_overpromising".',
          ].join("\n"),
        },
      ],
      {
        good: 1,
        needs_work: 0.5,
        unsafe_or_overpromising: 0,
      },
      false,
      z.object({
        output: z.any(),
      }),
      {
        tags: [`uses:param:${runtimeParametersSlug}`, "span:reply-writer"],
        metadata: {
          runtime_parameter_slugs: [runtimeParametersSlug],
          runtime_parameter_fields: ["model"],
          published_model_source: `${runtimeParametersSlug}.model`,
          related_parameter_slug: runtimeParametersSlug,
          evaluates_span_names: ["reply-writer"],
        },
      },
    ),
  ];
}

export function registerRemoteScorers(
  project: BraintrustProject,
  options: { ifExists: BraintrustIfExists; model: string },
  kinds: RemoteScorerKind[] = ["code", "llm"],
): void {
  for (const scorer of getRemoteScorerRegistrations().filter((item) => kinds.includes(item.kind))) {
    scorer.register(project, options);
  }
}

function relayOutput(chunk: Buffer, onLog?: (line: string) => void) {
  const text = chunk.toString("utf8");

  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    onLog?.(line);
  }
}

async function runBraintrustPush(
  args: string[],
  env: Record<string, string>,
  onLog?: (line: string) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("braintrust", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => relayOutput(chunk, onLog));
    child.stderr.on("data", (chunk) => relayOutput(chunk, onLog));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`braintrust push exited with code ${code}.`));
    });
  });
}

async function createGeneratedPushFile(
  templatePath: string,
  projectName: string,
): Promise<string> {
  const generatedPath = join(
    dirname(templatePath),
    `.${parse(templatePath).name}.generated.${process.pid}.${Date.now()}.ts`,
  );
  const templateSource = await readFile(templatePath, "utf8");
  const generatedSource = templateSource.replaceAll(PUSH_PROJECT_NAME_PLACEHOLDER, JSON.stringify(projectName));

  await writeFile(generatedPath, generatedSource, "utf8");

  return generatedPath;
}

async function withGeneratedPushFile<T>(
  templatePath: string,
  projectName: string,
  callback: (generatedPath: string) => Promise<T>,
): Promise<T> {
  const generatedPath = await createGeneratedPushFile(templatePath, projectName);

  try {
    return await callback(generatedPath);
  } finally {
    await rm(generatedPath, { force: true });
  }
}

export async function setupBraintrustScorers(
  config: BraintrustScorerBootstrapConfig,
  options?: { dryRun?: boolean; onLog?: (line: string) => void },
): Promise<BraintrustScorerBootstrapResult> {
  const ifExists = config.ifExists ?? "ignore";
  const model = config.model ?? "gpt-5-mini";
  const scorerSpecs = getRemoteScorerRegistrations();
  const llmScorers = scorerSpecs.filter((scorer) => scorer.kind === "llm");
  const codeScorers = scorerSpecs.filter((scorer) => scorer.kind === "code");

  const result: BraintrustScorerBootstrapResult = {
    dryRun: options?.dryRun ?? false,
    ifExists,
    model,
    projectName: config.projectName,
    scorers: scorerSpecs.map((scorer) => ({
      description: scorer.description,
      kind: scorer.kind,
      name: scorer.name,
      onlineEligible: scorer.onlineEligible,
      slug: scorer.slug,
    })),
  };

  if (options?.dryRun) {
    options.onLog?.(`Preflight: would publish ${scorerSpecs.length} scorer(s) with ifExists=${ifExists}.`);
    return result;
  }

  const projectId = await ensureBraintrustProject(config.projectName);
  result.projectId = projectId;
  if (llmScorers.length > 0) {
    options?.onLog?.(`Publish: pushing ${llmScorers.length} LLM scorer(s) via braintrust push.`);
    await withGeneratedPushFile(
      join(process.cwd(), "src/braintrust/push-llm-scorers.ts"),
      config.projectName,
      async (generatedPath) =>
        runBraintrustPush(
          ["push", generatedPath],
          {
            BRAINTRUST_PROJECT: config.projectName,
            BRAINTRUST_SCORER_IF_EXISTS: ifExists,
            OPENAI_MODEL: model,
          },
          options?.onLog,
        ),
    );
  }

  options?.onLog?.(`Publish: pushing ${codeScorers.length} code scorer(s) via braintrust push.`);

  await withGeneratedPushFile(
    join(process.cwd(), "src/braintrust/push-scorers.ts"),
    config.projectName,
    async (generatedPath) =>
      runBraintrustPush(
        ["push", generatedPath],
        {
          BRAINTRUST_PROJECT: config.projectName,
          BRAINTRUST_SCORER_IF_EXISTS: ifExists,
          OPENAI_MODEL: model,
        },
        options?.onLog,
      ),
  );

  options?.onLog?.(`Publish: completed ${scorerSpecs.length} scorer(s) for project "${config.projectName}".`);

  return result;
}

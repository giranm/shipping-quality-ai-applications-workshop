import { braintrustApiRequest, ensureBraintrustProject, getProjectFunctionBySlug } from "./api.js";
import { remoteScorerSlugs, type RemoteScorerSlug } from "./remote-scorers.js";

type OnlineRuleScope = "trace" | "span";
const ROOT_SPAN_NAMES = [
  "support-triage-demo",
  "support-triage-manual",
  "replay-prod-failure",
  "support-triage-online-verify",
] as const;

type OnlineRuleSpec = {
  btqlFilter?: string;
  description: string;
  name: string;
  scorerSlugs: RemoteScorerSlug[];
  scope: OnlineRuleScope;
  spanNames?: string[];
};

type ProjectScoreRecord = {
  id: string;
  name: string;
  score_type: string;
};

export type BraintrustOnlineRuleBootstrapConfig = {
  projectName: string;
};

export type BraintrustOnlineRuleBootstrapResult = {
  dryRun: boolean;
  projectId?: string;
  projectName: string;
  rules: Array<{
    description: string;
    id?: string;
    name: string;
    scope: OnlineRuleScope;
    scorerSlugs: RemoteScorerSlug[];
    spanNames?: string[];
  }>;
};

function buildOnlineRuleSpecs(): OnlineRuleSpec[] {
  return [
    {
      name: "helpr-root-quality-online",
      description: "Scores final root support spans with schema, guardrail, and overall quality checks.",
      scope: "span",
      btqlFilter: "metadata.source IS NOT NULL",
      spanNames: [...ROOT_SPAN_NAMES],
      scorerSlugs: [
        remoteScorerSlugs.schemaValid,
        remoteScorerSlugs.requiredFieldsPresent,
        remoteScorerSlugs.escalationReasonPresent,
        remoteScorerSlugs.confidenceInRange,
        remoteScorerSlugs.enterpriseBlockedNotLow,
        remoteScorerSlugs.rootTriageQualityJudge,
      ],
    },
    {
      name: "helpr-reply-quality-online",
      description: "Scores reply-writer spans with heuristic and LLM-based tone checks.",
      scope: "span",
      spanNames: ["reply-writer"],
      scorerSlugs: [remoteScorerSlugs.customerReplyRubric, remoteScorerSlugs.replyToneClassifier],
    },
    {
      name: "helpr-stage-structure-online",
      description: "Checks that specialist stage spans emit structured outputs.",
      scope: "span",
      spanNames: ["triage-specialist", "policy-reviewer", "reply-writer"],
      scorerSlugs: [remoteScorerSlugs.stageOutputPresent],
    },
  ];
}

async function resolveScorerReference(
  projectId: string,
  slug: RemoteScorerSlug,
): Promise<{ id: string; type: "function"; version: string }> {
  const scorer = await getProjectFunctionBySlug(projectId, slug, "scorer");

  if (!scorer._xact_id) {
    throw new Error(`Braintrust scorer ${slug} is missing a function version.`);
  }

  return {
    id: scorer.id,
    type: "function",
    version: scorer._xact_id,
  };
}

async function upsertOnlineRule(
  projectId: string,
  spec: OnlineRuleSpec,
  scorerRefs: Array<{ id: string; type: "function"; version: string }>,
): Promise<ProjectScoreRecord> {
  return braintrustApiRequest<ProjectScoreRecord>("/v1/project_score", {
    method: "PUT",
    body: {
      project_id: projectId,
      name: spec.name,
      description: spec.description,
      score_type: "online",
      config: {
        online: {
          sampling_rate: 1,
          scorers: scorerRefs,
          btql_filter: spec.btqlFilter,
          ...(spec.scope === "trace"
            ? {
                scope: { type: "trace" },
              }
            : {
                scope: { type: "span" },
                apply_to_span_names: spec.spanNames,
              }),
        },
      },
    },
  });
}

export async function setupBraintrustOnlineRules(
  config: BraintrustOnlineRuleBootstrapConfig,
  options?: { dryRun?: boolean; onLog?: (line: string) => void },
): Promise<BraintrustOnlineRuleBootstrapResult> {
  const ruleSpecs = buildOnlineRuleSpecs();
  const result: BraintrustOnlineRuleBootstrapResult = {
    dryRun: options?.dryRun ?? false,
    projectName: config.projectName,
    rules: ruleSpecs.map((rule) => ({
      description: rule.description,
      name: rule.name,
      scope: rule.scope,
      scorerSlugs: rule.scorerSlugs,
      spanNames: rule.spanNames,
    })),
  };

  if (options?.dryRun) {
    options.onLog?.(`Preflight: would upsert ${ruleSpecs.length} online scoring rule(s).`);
    return result;
  }

  const projectId = await ensureBraintrustProject(config.projectName);
  result.projectId = projectId;

  for (const rule of ruleSpecs) {
    options?.onLog?.(`Publish: resolving scorer refs for online rule ${rule.name}.`);
    const scorerRefs = await Promise.all(rule.scorerSlugs.map((slug) => resolveScorerReference(projectId, slug)));
    const savedRule = await upsertOnlineRule(projectId, rule, scorerRefs);
    options?.onLog?.(`Publish: upserted online rule ${rule.name} (${savedRule.id}).`);

    const resultRule = result.rules.find((item) => item.name === rule.name);
    if (resultRule) {
      resultRule.id = savedRule.id;
    }
  }

  return result;
}

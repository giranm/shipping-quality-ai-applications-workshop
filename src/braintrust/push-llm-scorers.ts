import braintrust from "braintrust";
import { z } from "zod/v3";

import { runtimeParametersSlug } from "./parameters.js";

// setup-braintrust rewrites this placeholder into a literal project name before
// calling `braintrust push`, so the remote scorer runtime does not need custom env vars.
const projectName = process.env.BRAINTRUST_PROJECT ?? "__BRAINTRUST_PROJECT_NAME__";

const ifExistsEnv = process.env.BRAINTRUST_SCORER_IF_EXISTS;
const ifExists = ifExistsEnv === "error" || ifExistsEnv === "replace" || ifExistsEnv === "ignore"
  ? ifExistsEnv
  : "ignore";
const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";

const project = braintrust.projects.create({ name: projectName });
const scorerBuilder = project.scorers as { create(opts: Record<string, unknown>): void };

scorerBuilder.create({
  name: "Helpr Root Triage Quality Judge",
  slug: "helpr-root-triage-quality-judge",
  description: "LLM judge for overall triage quality on the full request trace. Published model follows helpr-runtime-config.model.",
  ifExists,
  tags: ["helpr", "managed", "scorer", "kind:llm", "scope:online", `uses:param:${runtimeParametersSlug}`, "span:root"],
  metadata: {
    component: "helpr",
    object_role: "managed_scorer",
    scorer_kind: "llm",
    scorer_slug: "helpr-root-triage-quality-judge",
    online_eligible: true,
    managed_by: "make setup-braintrust",
    runtime_parameter_slugs: [runtimeParametersSlug],
    runtime_parameter_fields: ["model"],
    published_model_source: `${runtimeParametersSlug}.model`,
    related_parameter_slug: runtimeParametersSlug,
    evaluates_span_names: ["support-triage-demo", "support-triage-manual", "replay-prod-failure", "support-triage-online-verify"],
  },
  parameters: z.object({
    input: z.any().optional(),
    output: z.any().optional(),
    trace: z.any().optional(),
  }),
  messages: [
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
  model,
  useCot: true,
  choiceScores: {
    excellent: 1,
    good: 0.85,
    mixed: 0.5,
    poor: 0,
  },
});

scorerBuilder.create({
  name: "Helpr Reply Tone Classifier",
  slug: "helpr-reply-tone-classifier",
  description: "LLM judge for reply tone, clarity, and overpromising risk on reply-writer spans. Published model follows helpr-runtime-config.model.",
  ifExists,
  tags: ["helpr", "managed", "scorer", "kind:llm", "scope:online", `uses:param:${runtimeParametersSlug}`, "span:reply-writer"],
  metadata: {
    component: "helpr",
    object_role: "managed_scorer",
    scorer_kind: "llm",
    scorer_slug: "helpr-reply-tone-classifier",
    online_eligible: true,
    managed_by: "make setup-braintrust",
    runtime_parameter_slugs: [runtimeParametersSlug],
    runtime_parameter_fields: ["model"],
    published_model_source: `${runtimeParametersSlug}.model`,
    related_parameter_slug: runtimeParametersSlug,
    evaluates_span_names: ["reply-writer"],
  },
  parameters: z.object({
    output: z.any(),
  }),
  messages: [
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
  model,
  useCot: false,
  choiceScores: {
    good: 1,
    needs_work: 0.5,
    unsafe_or_overpromising: 0,
  },
});

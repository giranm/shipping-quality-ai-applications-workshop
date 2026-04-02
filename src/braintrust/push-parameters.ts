import { projects } from "braintrust";

import { runtimeParametersSlug } from "./parameters.js";

// setup-braintrust rewrites this placeholder into a literal project name before
// calling `braintrust push`, so the remote parameter runtime does not need custom env vars.
const projectName = process.env.BRAINTRUST_PROJECT ?? "__BRAINTRUST_PROJECT_NAME__";
const runtimeModelDefault = "__HELPR_RUNTIME_MODEL_DEFAULT__";

const ifExistsEnv = process.env.BRAINTRUST_PARAMETER_IF_EXISTS ?? process.env.BRAINTRUST_IF_EXISTS;
const ifExists = ifExistsEnv === "error" || ifExistsEnv === "replace" || ifExistsEnv === "ignore"
  ? ifExistsEnv
  : "ignore";

const project = projects.create({ name: projectName });

project.parameters.create({
  name: "Helpr Runtime Config",
  slug: runtimeParametersSlug,
  description:
    "Managed runtime defaults for Helpr demos and evals. The active model value is used by the managed prompt runtime, prompt publication, and LLM judge scorer publication.",
  schema: {
    model: {
      type: "model",
      default: runtimeModelDefault,
      description: "Default model for managed Helpr runs.",
    },
  },
  metadata: {
    component: "helpr",
    object_role: "managed_parameter",
    managed_by: "make setup-braintrust",
    active_value_source: "braintrust_ui",
    schema_owned_by: "code",
    runtime_consumers: ["triage-specialist", "policy-reviewer", "reply-writer"],
    publication_consumers: {
      prompts: ["helpr-triage-specialist", "helpr-policy-reviewer", "helpr-reply-writer"],
      scorers: ["helpr-root-triage-quality-judge", "helpr-reply-tone-classifier"],
    },
  },
  ifExists,
});

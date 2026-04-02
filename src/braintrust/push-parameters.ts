import { projects } from "braintrust";

import { runtimeParametersSlug } from "./parameters.js";

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
  description: "Managed runtime defaults for Helpr demos and evals.",
  schema: {
    model: {
      type: "model",
      default: runtimeModelDefault,
      description: "Default model for managed Helpr runs.",
    },
  },
  ifExists,
});

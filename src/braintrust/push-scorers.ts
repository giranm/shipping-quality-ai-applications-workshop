import { projects } from "braintrust";

import { registerRemoteScorers } from "./remote-scorers.js";

// setup-braintrust rewrites this placeholder into a literal project name before
// calling `braintrust push`, so the remote scorer runtime does not need custom env vars.
const projectName = process.env.BRAINTRUST_PROJECT ?? "__BRAINTRUST_PROJECT_NAME__";

const ifExistsEnv = process.env.BRAINTRUST_SCORER_IF_EXISTS;
const ifExists = ifExistsEnv === "error" || ifExistsEnv === "replace" || ifExistsEnv === "ignore"
  ? ifExistsEnv
  : "ignore";

const project = projects.create({ name: projectName });

registerRemoteScorers(project, {
  ifExists,
  model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
}, ["code"]);

import { projects } from "braintrust";

import { registerManagedTools } from "./tools.js";

const projectName = process.env.BRAINTRUST_PROJECT ?? "__BRAINTRUST_PROJECT_NAME__";

const ifExistsEnv = process.env.BRAINTRUST_TOOL_IF_EXISTS ?? process.env.BRAINTRUST_IF_EXISTS;
const ifExists = ifExistsEnv === "error" || ifExistsEnv === "replace" || ifExistsEnv === "ignore"
  ? ifExistsEnv
  : "ignore";

const project = projects.create({ name: projectName });

registerManagedTools(project, ifExists);

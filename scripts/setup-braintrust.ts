import "dotenv/config";

import type { BraintrustIfExists } from "../src/braintrust/api.js";
import { setupBraintrustOnlineRules } from "../src/braintrust/online-rules.js";
import { defaultRuntimeModel, setupBraintrustParameters } from "../src/braintrust/parameters.js";
import { setupBraintrustPrompts } from "../src/braintrust/prompts.js";
import { setupBraintrustScorers } from "../src/braintrust/remote-scorers.js";
import { setupBraintrustTools } from "../src/braintrust/tools.js";

function parseIfExists(argv: string[]): BraintrustIfExists | undefined {
  if (argv.includes("--replace")) {
    return "replace";
  }

  if (argv.includes("--error")) {
    return "error";
  }

  if (argv.includes("--ignore")) {
    return "ignore";
  }

  const envValue =
    process.env.BRAINTRUST_IF_EXISTS ??
    process.env.BRAINTRUST_SCORER_IF_EXISTS ??
    process.env.BRAINTRUST_PROMPT_IF_EXISTS;

  if (envValue === "error" || envValue === "ignore" || envValue === "replace") {
    return envValue;
  }

  return undefined;
}

function preserveRemoteParameterValues(argv: string[]): boolean {
  if (argv.includes("--force-parameter-values")) {
    return false;
  }

  const envValue = process.env.BRAINTRUST_FORCE_PARAMETER_VALUES?.toLowerCase();
  if (envValue === "1" || envValue === "true" || envValue === "yes") {
    return false;
  }

  return true;
}

const dryRun = process.argv.includes("--dry-run");
const projectName = process.env.BRAINTRUST_PROJECT;

if (!projectName) {
  throw new Error("BRAINTRUST_PROJECT is required.");
}

if (!dryRun && !process.env.BRAINTRUST_API_KEY) {
  throw new Error("BRAINTRUST_API_KEY is required unless --dry-run is used.");
}

const ifExists = parseIfExists(process.argv);
const preserveParameterValues = preserveRemoteParameterValues(process.argv);
const parametersResult = await setupBraintrustParameters(
  {
    projectName,
    ifExists,
    preserveRemoteValues: preserveParameterValues,
  },
  {
    dryRun,
    onLog: (line) => console.log(line),
  },
);
const runtimeParameters = dryRun
  ? { model: parametersResult.values.model ?? defaultRuntimeModel }
  : parametersResult.values;
const promptResult = await setupBraintrustPrompts(
  {
    projectName,
    ifExists,
    model: runtimeParameters.model,
  },
  {
    dryRun,
    onLog: (line) => console.log(line),
  },
);
const toolResult = await setupBraintrustTools(
  {
    projectName,
    ifExists,
  },
  {
    dryRun,
    onLog: (line) => console.log(line),
  },
);
console.log(`Preflight: using managed runtime model "${runtimeParameters.model}" for prompt publication.`);
console.log(`Preflight: using managed runtime model "${runtimeParameters.model}" for LLM scorer publication.`);
const scorerResult = await setupBraintrustScorers(
  {
    projectName,
    ifExists,
    model: runtimeParameters.model,
  },
  {
    dryRun,
    onLog: (line) => console.log(line),
  },
);
const onlineRuleResult = await setupBraintrustOnlineRules(
  {
    projectName,
  },
  {
    dryRun,
    onLog: (line) => console.log(line),
  },
);

console.log(
  `${dryRun ? "Planned" : "Bootstrapped"} Braintrust project ${promptResult.projectName} with ${promptResult.prompts.length} prompt(s), ${toolResult.tools.length} tool(s), 1 parameter object(s), ${scorerResult.scorers.length} scorer(s), and ${onlineRuleResult.rules.length} online rule(s).`,
);
console.log(
  JSON.stringify(
    {
      prompts: promptResult,
      tools: toolResult,
      parameters: parametersResult,
      scorers: scorerResult,
      online_rules: onlineRuleResult,
    },
    null,
    2,
  ),
);

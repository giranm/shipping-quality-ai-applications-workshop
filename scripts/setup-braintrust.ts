import "dotenv/config";

import type { BraintrustIfExists } from "../src/braintrust/api.js";
import { defaultRuntimeModel, setupBraintrustParameters } from "../src/braintrust/parameters.js";
import { setupBraintrustPrompts } from "../src/braintrust/prompts.js";

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

  const envValue = process.env.BRAINTRUST_IF_EXISTS;

  if (envValue === "error" || envValue === "ignore" || envValue === "replace") {
    return envValue;
  }

  return undefined;
}

function preserveRemoteParameterValues(argv: string[]): boolean {
  return !argv.includes("--force-parameter-values");
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

console.log(`Preflight: using managed runtime model "${runtimeParameters.model}" for prompt publication.`);
console.log(
  `${dryRun ? "Planned" : "Bootstrapped"} Braintrust project ${promptResult.projectName} with ${promptResult.prompts.length} prompt(s) and 1 parameter object(s).`,
);
console.log(
  JSON.stringify(
    {
      prompts: promptResult,
      parameters: parametersResult,
    },
    null,
    2,
  ),
);

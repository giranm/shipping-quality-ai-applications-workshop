import { loadParameters } from "braintrust";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

import { ensureBraintrustProject, type BraintrustIfExists } from "./api.js";

export const runtimeParametersSlug = "helpr-runtime-config";
const PUSH_PROJECT_NAME_PLACEHOLDER = "\"__BRAINTRUST_PROJECT_NAME__\"";
const PUSH_RUNTIME_MODEL_PLACEHOLDER = "\"__HELPR_RUNTIME_MODEL_DEFAULT__\"";
export const defaultRuntimeModel = "gpt-5-mini";

export const helprRuntimeParametersSchema = {
  model: {
    type: "model" as const,
    default: defaultRuntimeModel,
    description: "Default model for managed Helpr runs.",
  },
};

export type HelprRuntimeParameters = {
  model: string;
};

export type BraintrustParametersBootstrapConfig = {
  ifExists?: BraintrustIfExists;
  preserveRemoteValues?: boolean;
  projectName: string;
};

export type BraintrustParametersBootstrapResult = {
  dryRun: boolean;
  ifExists: BraintrustIfExists;
  projectId?: string;
  projectName: string;
  parameters: {
    description: string;
    name: string;
    slug: string;
  };
  values: HelprRuntimeParameters;
};

function relayOutput(chunk: Buffer, onLog?: (line: string) => void) {
  const text = chunk.toString("utf8");

  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    onLog?.(line);
  }
}

async function createGeneratedPushFile(
  templatePath: string,
  replacements: Record<string, string>,
): Promise<string> {
  const generatedPath = join(
    dirname(templatePath),
    `.${parse(templatePath).name}.generated.${process.pid}.${Date.now()}.ts`,
  );
  const templateSource = await readFile(templatePath, "utf8");
  const generatedSource = Object.entries(replacements).reduce(
    (source, [placeholder, value]) => source.replaceAll(placeholder, JSON.stringify(value)),
    templateSource,
  );

  await writeFile(generatedPath, generatedSource, "utf8");

  return generatedPath;
}

async function withGeneratedPushFile<T>(
  templatePath: string,
  replacements: Record<string, string>,
  callback: (generatedPath: string) => Promise<T>,
): Promise<T> {
  const generatedPath = await createGeneratedPushFile(templatePath, replacements);

  try {
    return await callback(generatedPath);
  } finally {
    await rm(generatedPath, { force: true });
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

async function tryLoadExistingHelprRuntimeParameters(
  projectName: string,
  apiKey?: string,
): Promise<HelprRuntimeParameters | null> {
  try {
    const params = await loadParameters<typeof helprRuntimeParametersSchema>({
      projectName,
      slug: runtimeParametersSlug,
      ...(apiKey ? { apiKey } : {}),
    });
    const data = params.data as Partial<HelprRuntimeParameters>;

    return {
      model: data.model ?? defaultRuntimeModel,
    };
  } catch {
    return null;
  }
}

export async function setupBraintrustParameters(
  config: BraintrustParametersBootstrapConfig,
  options?: { dryRun?: boolean; onLog?: (line: string) => void },
): Promise<BraintrustParametersBootstrapResult> {
  const ifExists = config.ifExists ?? "ignore";
  const preserveRemoteValues = config.preserveRemoteValues ?? true;
  const result: BraintrustParametersBootstrapResult = {
    dryRun: options?.dryRun ?? false,
    ifExists,
    projectName: config.projectName,
    parameters: {
      name: "Helpr Runtime Config",
      slug: runtimeParametersSlug,
      description: "Managed runtime defaults for Helpr demos and evals.",
    },
    values: {
      model: defaultRuntimeModel,
    },
  };

  if (options?.dryRun) {
    options.onLog?.(`Preflight: would ensure Braintrust project "${config.projectName}" exists for parameters.`);
    options.onLog?.(
      `Preflight: would push parameters ${runtimeParametersSlug} with ifExists=${ifExists} and preserveRemoteValues=${preserveRemoteValues}.`,
    );
    return result;
  }

  result.projectId = await ensureBraintrustProject(config.projectName);
  const existingValues = preserveRemoteValues
    ? await tryLoadExistingHelprRuntimeParameters(config.projectName, process.env.BRAINTRUST_API_KEY)
    : null;
  result.values = existingValues ?? {
    model: defaultRuntimeModel,
  };

  if (existingValues) {
    options?.onLog?.(
      `Preflight: preserving remote parameter values for ${runtimeParametersSlug} (model=${existingValues.model}).`,
    );
  } else if (preserveRemoteValues) {
    options?.onLog?.(
      `Preflight: no remote parameter value found for ${runtimeParametersSlug}; using code default model=${result.values.model}.`,
    );
  } else {
    options?.onLog?.(
      `Preflight: forcing code-defined parameter values for ${runtimeParametersSlug} (model=${result.values.model}).`,
    );
  }

  options?.onLog?.(`Publish: pushing parameters ${runtimeParametersSlug} via braintrust push.`);
  await withGeneratedPushFile(
    join(process.cwd(), "src/braintrust/push-parameters.ts"),
    {
      [PUSH_PROJECT_NAME_PLACEHOLDER]: config.projectName,
      [PUSH_RUNTIME_MODEL_PLACEHOLDER]: result.values.model,
    },
    async (generatedPath) =>
      runBraintrustPush(
        ["push", generatedPath],
        {
          BRAINTRUST_PROJECT: config.projectName,
          BRAINTRUST_PARAMETER_IF_EXISTS: ifExists,
        },
        options?.onLog,
      ),
  );
  options?.onLog?.(`Publish: completed parameters ${runtimeParametersSlug} for project "${config.projectName}".`);

  return result;
}

export async function loadHelprRuntimeParameters(
  projectName: string,
  apiKey?: string,
): Promise<HelprRuntimeParameters> {
  return (await tryLoadExistingHelprRuntimeParameters(projectName, apiKey)) ?? {
    model: defaultRuntimeModel,
  };
}

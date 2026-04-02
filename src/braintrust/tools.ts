import { currentSpan, invoke, projects, type Span } from "braintrust";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { z } from "zod/v3";

import { ensureBraintrustProject, type BraintrustIfExists } from "./api.js";
import { createEscalation, lookupRecentAccountEvents, searchHelpCenter } from "../tools.js";
import type { EscalationResult, HelpCenterResult, RecentAccountEvent } from "../schemas.js";

type BraintrustProject = ReturnType<typeof projects.create>;
const PUSH_PROJECT_NAME_PLACEHOLDER = "\"__BRAINTRUST_PROJECT_NAME__\"";

const searchHelpCenterParametersSchema = z.object({
  query: z.string().min(1),
});
const lookupRecentAccountEventsParametersSchema = z.object({
  account_id: z.string().min(1).optional(),
});
const createEscalationParametersSchema = z.object({
  reason: z.string().min(1),
});

const helpCenterResultsSchema = z.array(
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    tags: z.array(z.string().min(1)),
    snippet: z.string().min(1),
  }),
);
const recentAccountEventsSchema = z.array(
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    summary: z.string().min(1),
    occurred_at: z.string().min(1),
  }),
);
const escalationResultReturnSchema = z.object({
  id: z.string().min(1),
  queue: z.string().min(1),
  eta_minutes: z.number(),
  reason: z.string().min(1),
});

export const managedToolSlugs = {
  searchHelpCenter: "helpr-search-help-center",
  lookupRecentAccountEvents: "helpr-lookup-recent-account-events",
  createEscalation: "helpr-create-escalation",
} as const;

export type ManagedToolSlug = (typeof managedToolSlugs)[keyof typeof managedToolSlugs];

type ManagedToolRegistration = {
  description: string;
  name: string;
  register(project: BraintrustProject, ifExists: BraintrustIfExists): void;
  slug: ManagedToolSlug;
};

type ToolDefinition = {
  type: "function";
  function: {
    name: ManagedToolSlug;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
};

export type BraintrustToolBootstrapConfig = {
  ifExists?: BraintrustIfExists;
  projectName: string;
};

export type BraintrustToolBootstrapResult = {
  dryRun: boolean;
  ifExists: BraintrustIfExists;
  projectId?: string;
  projectName: string;
  tools: Array<{
    description: string;
    name: string;
    slug: ManagedToolSlug;
  }>;
};

export type InvokeManagedToolArgs = {
  input: unknown;
  parentSpan?: Span | null;
  projectName: string;
  slug: ManagedToolSlug;
};

function logToolSpanMetadata(data: Record<string, unknown>): void {
  try {
    currentSpan()?.log({ metadata: data });
  } catch {
    // Best-effort enrichment; tool execution should continue even if metadata logging fails.
  }
}

function getManagedToolRegistrations(): ManagedToolRegistration[] {
  return [
    {
      name: "Helpr Search Help Center",
      slug: managedToolSlugs.searchHelpCenter,
      description: "Returns the most relevant help-center snippets for a support ticket query.",
      register(project, ifExists) {
        project.tools.create({
          name: "Helpr Search Help Center",
          slug: managedToolSlugs.searchHelpCenter,
          description: "Search the Helpr help center and return the most relevant articles.",
          ifExists,
          parameters: searchHelpCenterParametersSchema,
          returns: helpCenterResultsSchema,
          handler: ({ query }) => {
            const result = searchHelpCenter(query);
            logToolSpanMetadata({
              component: "helpr",
              object_role: "tool_span",
              tool_slug: managedToolSlugs.searchHelpCenter,
              query_length: query.length,
              result_count: result.length,
            });
            return result;
          },
        });
      },
    },
    {
      name: "Helpr Lookup Recent Account Events",
      slug: managedToolSlugs.lookupRecentAccountEvents,
      description: "Looks up recent account events for a customer account.",
      register(project, ifExists) {
        project.tools.create({
          name: "Helpr Lookup Recent Account Events",
          slug: managedToolSlugs.lookupRecentAccountEvents,
          description: "Return the most recent account events for a customer account when an account ID is available.",
          ifExists,
          parameters: lookupRecentAccountEventsParametersSchema,
          returns: recentAccountEventsSchema,
          handler: ({ account_id }) => {
            const result = lookupRecentAccountEvents(account_id);
            logToolSpanMetadata({
              component: "helpr",
              object_role: "tool_span",
              tool_slug: managedToolSlugs.lookupRecentAccountEvents,
              has_account_id: Boolean(account_id),
              result_count: result.length,
            });
            return result;
          },
        });
      },
    },
    {
      name: "Helpr Create Escalation",
      slug: managedToolSlugs.createEscalation,
      description: "Creates a support escalation record for an approved escalation reason.",
      register(project, ifExists) {
        project.tools.create({
          name: "Helpr Create Escalation",
          slug: managedToolSlugs.createEscalation,
          description: "Create a support escalation record after the application has decided escalation is required.",
          ifExists,
          parameters: createEscalationParametersSchema,
          returns: escalationResultReturnSchema,
          handler: ({ reason }) => {
            const result = createEscalation(reason);
            logToolSpanMetadata({
              component: "helpr",
              object_role: "tool_span",
              tool_slug: managedToolSlugs.createEscalation,
              reason_length: reason.length,
              queue: result.queue,
              eta_minutes: result.eta_minutes,
            });
            return result;
          },
        });
      },
    },
  ];
}

function relayOutput(chunk: Buffer, onLog?: (line: string) => void) {
  const text = chunk.toString("utf8");

  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    onLog?.(line);
  }
}

export function buildManagedPromptToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: managedToolSlugs.searchHelpCenter,
        description: "Search the Helpr help center and return the most relevant articles.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query built from the ticket and product area.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    {
      type: "function",
      function: {
        name: managedToolSlugs.lookupRecentAccountEvents,
        description: "Look up recent account events for a customer account.",
        parameters: {
          type: "object",
          properties: {
            account_id: {
              type: "string",
              description: "Customer account ID when available.",
            },
          },
          required: ["account_id"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  ];
}

export function registerManagedTools(project: BraintrustProject, ifExists: BraintrustIfExists = "ignore"): void {
  for (const registration of getManagedToolRegistrations()) {
    registration.register(project, ifExists);
  }
}

async function createTempPushFile(scriptPath: string, projectName: string): Promise<string> {
  const generatedPath = join(
    dirname(scriptPath),
    `.${parse(scriptPath).name}.generated.${process.pid}.${Date.now()}.ts`,
  );
  const source = await readFile(scriptPath, "utf8");
  await writeFile(generatedPath, source.replaceAll(PUSH_PROJECT_NAME_PLACEHOLDER, JSON.stringify(projectName)), "utf8");
  return generatedPath;
}

async function pushToolBundle(
  scriptPath: string,
  ifExists: BraintrustIfExists,
  projectName: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const tempFilePath = await createTempPushFile(scriptPath, projectName);
  const args = ["push", tempFilePath];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("braintrust", args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BRAINTRUST_PROJECT: projectName,
          BRAINTRUST_TOOL_IF_EXISTS: ifExists,
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
  } finally {
    await rm(tempFilePath, { force: true });
  }
}

export async function setupBraintrustTools(
  config: BraintrustToolBootstrapConfig,
  options?: { dryRun?: boolean; onLog?: (line: string) => void },
): Promise<BraintrustToolBootstrapResult> {
  const ifExists = config.ifExists ?? "ignore";
  const tools = getManagedToolRegistrations();
  const result: BraintrustToolBootstrapResult = {
    dryRun: options?.dryRun ?? false,
    ifExists,
    projectName: config.projectName,
    tools: tools.map((tool) => ({
      description: tool.description,
      name: tool.name,
      slug: tool.slug,
    })),
  };

  if (options?.dryRun) {
    options?.onLog?.(`Preflight: would ensure Braintrust project "${config.projectName}" exists for tools.`);
    options?.onLog?.(`Preflight: would push ${tools.length} managed tool(s) with ifExists=${ifExists}.`);
    return result;
  }

  result.projectId = await ensureBraintrustProject(config.projectName);
  options?.onLog?.(`Publish: pushing ${tools.length} managed tool(s) via braintrust push.`);
  await pushToolBundle(
    join(process.cwd(), "src/braintrust/push-tools.ts"),
    ifExists,
    config.projectName,
    options?.onLog,
  );
  options?.onLog?.(`Publish: completed managed tools for project "${config.projectName}".`);

  return result;
}

export async function invokeManagedTool(args: InvokeManagedToolArgs): Promise<unknown> {
  return invoke({
    projectName: args.projectName,
    slug: args.slug,
    functionType: "tool",
    input: args.input,
    apiKey: process.env.BRAINTRUST_API_KEY,
    ...(args.parentSpan ? { parent: args.parentSpan } : {}),
  });
}

export async function invokeManagedSearchHelpCenter(
  projectName: string,
  query: string,
  parentSpan?: Span | null,
): Promise<HelpCenterResult[]> {
  const output = await invokeManagedTool({
    projectName,
    slug: managedToolSlugs.searchHelpCenter,
    input: { query },
    parentSpan,
  });

  return helpCenterResultsSchema.parse(output) as HelpCenterResult[];
}

export async function invokeManagedLookupRecentAccountEvents(
  projectName: string,
  accountId: string | undefined,
  parentSpan?: Span | null,
): Promise<RecentAccountEvent[]> {
  const output = await invokeManagedTool({
    projectName,
    slug: managedToolSlugs.lookupRecentAccountEvents,
    input: accountId ? { account_id: accountId } : {},
    parentSpan,
  });

  return recentAccountEventsSchema.parse(output) as RecentAccountEvent[];
}

export async function invokeManagedCreateEscalation(
  projectName: string,
  reason: string,
  parentSpan?: Span | null,
): Promise<EscalationResult> {
  const output = await invokeManagedTool({
    projectName,
    slug: managedToolSlugs.createEscalation,
    input: { reason },
    parentSpan,
  });

  return escalationResultReturnSchema.parse(output) as EscalationResult;
}

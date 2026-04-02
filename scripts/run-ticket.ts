import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { runSupportTriageDetailed } from "../src/app.js";
import {
  buildTicketMetadata,
  createBraintrustOpenAIClient,
  withTrace,
} from "../src/braintrust/tracing.js";
import { accountEventsByAccountId } from "../src/sample-data.js";
import {
  customerTierSchema,
  productAreaSchema,
  ticketInputSchema,
  type TicketInput,
  type TriageResult,
} from "../src/schemas.js";

type PromptReader = {
  close(): void;
  question(query: string): Promise<string>;
};

type CliOptions = {
  debug: boolean;
};

const customerTierOptions = customerTierSchema.options;
const productAreaOptions = productAreaSchema.options;
const sampleAccountIds = Object.keys(accountEventsByAccountId);

const accountLabels: Record<string, string> = {
  acct_104: "billing export / plan migration sample",
  acct_201: "SSO / domain migration sample",
  acct_309: "API automation / usage spike sample",
};

const defaultAccountIdByProductArea: Partial<Record<(typeof productAreaOptions)[number], string>> = {
  billing: "acct_104",
  auth: "acct_201",
  api: "acct_309",
};

const ansi = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  cyan: "\u001B[36m",
  blue: "\u001B[34m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
  magenta: "\u001B[35m",
};

const colorEnabled = output.isTTY && process.env.NO_COLOR === undefined;

function style(text: string, ...codes: string[]): string {
  if (!colorEnabled || codes.length === 0) {
    return text;
  }

  return `${codes.join("")}${text}${ansi.reset}`;
}

function parseCliOptions(argv: string[]): CliOptions {
  let debug = false;

  for (const arg of argv) {
    if (arg === "--debug") {
      debug = true;
      continue;
    }

    if (arg.startsWith("--debug=")) {
      const value = arg.slice("--debug=".length).trim().toLowerCase();
      debug = value === "true" || value === "1" || value === "yes";
    }
  }

  return { debug };
}

function printSpacing(): void {
  console.log("");
}

function printSection(title: string, body?: string): void {
  printSpacing();
  console.log(style(title, ansi.bold, ansi.blue));
  if (body) {
    console.log(body);
  }
}

function formatChoiceLine(label: string, value: string): string {
  return `${style(label.padEnd(18), ansi.dim)} ${value}`;
}

function formatTicketInputSummary(ticketInput: TicketInput): string {
  return [
    formatChoiceLine("Ticket", ticketInput.ticket),
    formatChoiceLine("Customer tier", ticketInput.customer_tier ?? "-"),
    formatChoiceLine("Product area", ticketInput.product_area ?? "-"),
    formatChoiceLine("Account ID", ticketInput.account_id ?? "-"),
  ].join("\n");
}

function colorSeverity(severity: TriageResult["severity"]): string {
  if (severity === "low") {
    return style(severity, ansi.green, ansi.bold);
  }

  if (severity === "medium") {
    return style(severity, ansi.yellow, ansi.bold);
  }

  if (severity === "high") {
    return style(severity, ansi.red, ansi.bold);
  }

  return style(severity, ansi.magenta, ansi.bold);
}

function colorEscalation(shouldEscalate: boolean): string {
  return shouldEscalate ? style("yes", ansi.red, ansi.bold) : style("no", ansi.green, ansi.bold);
}

function formatBlock(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function printResultSummary(result: TriageResult): void {
  printSection("Support Triage Result");
  console.log(formatChoiceLine("Category", style(result.category, ansi.cyan, ansi.bold)));
  console.log(formatChoiceLine("Severity", colorSeverity(result.severity)));
  console.log(formatChoiceLine("Escalate", colorEscalation(result.should_escalate)));
  console.log(formatChoiceLine("Confidence", `${Math.round(result.confidence * 100)}%`));

  if (result.escalation_reason.trim()) {
    printSection("Escalation Reason", formatBlock(result.escalation_reason));
  }

  printSection("Recommended Action", formatBlock(result.recommended_action));
  printSection("Customer Reply", formatBlock(result.customer_reply));
}

function inferDefaults(ticket: string): Pick<TicketInput, "customer_tier" | "product_area" | "account_id"> {
  const normalized = ticket.toLowerCase();

  if (/(invoice|billing|finance|export|upgrade|plan)/.test(normalized)) {
    return {
      customer_tier: "enterprise",
      product_area: "billing",
      account_id: "acct_104",
    };
  }

  if (/(sso|login|password|auth|domain|idp|identity)/.test(normalized)) {
    return {
      customer_tier: "enterprise",
      product_area: "auth",
      account_id: "acct_201",
    };
  }

  if (/(api|timeout|rate limit|rate-limit|automation|sync|throttl|request)/.test(normalized)) {
    return {
      customer_tier: "pro",
      product_area: "api",
      account_id: "acct_309",
    };
  }

  return {
    customer_tier: "pro",
    product_area: "general",
  };
}

async function promptForRequiredText(reader: PromptReader, label: string): Promise<string> {
  while (true) {
    const value = (await reader.question(`${label}: `)).trim();
    if (value) {
      return value;
    }

    console.log("A ticket description is required.");
  }
}

async function promptForChoice<T extends string>(
  reader: PromptReader,
  label: string,
  options: readonly T[],
  defaultValue: T,
): Promise<T> {
  const defaultIndex = options.indexOf(defaultValue);

  while (true) {
    console.log(`${label}:`);
    options.forEach((option, index) => {
      const suffix = option === defaultValue ? " (default)" : "";
      console.log(`  ${index + 1}. ${option}${suffix}`);
    });

    const answer = (await reader.question(`Select ${label.toLowerCase()} [${defaultIndex + 1}]: `)).trim();

    if (!answer) {
      return defaultValue;
    }

    const numericChoice = Number(answer);
    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= options.length) {
      return options[numericChoice - 1] as T;
    }

    const matched = options.find((option) => option === answer);
    if (matched) {
      return matched;
    }

    console.log(`Invalid ${label.toLowerCase()}. Enter a number from 1-${options.length} or an exact value.`);
  }
}

async function promptForAccountId(
  reader: PromptReader,
  defaultAccountId: string | undefined,
): Promise<string | undefined> {
  const defaultHint = defaultAccountId ?? "none";

  while (true) {
    console.log("Account ID examples:");
    sampleAccountIds.forEach((accountId, index) => {
      const suffix = accountId === defaultAccountId ? " (default)" : "";
      const label = accountLabels[accountId] ? ` - ${accountLabels[accountId]}` : "";
      console.log(`  ${index + 1}. ${accountId}${label}${suffix}`);
    });

    const answer = (
      await reader.question(
        `Select account id [${defaultHint}], type an exact account id, or enter 'none' to omit: `,
      )
    ).trim();

    if (!answer) {
      return defaultAccountId;
    }

    if (answer.toLowerCase() === "none") {
      return undefined;
    }

    const numericChoice = Number(answer);
    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= sampleAccountIds.length) {
      return sampleAccountIds[numericChoice - 1];
    }

    return answer;
  }
}

async function promptForConfirmation(reader: PromptReader): Promise<boolean> {
  const answer = (await reader.question("Run support triage with this ticket? [Y/n]: ")).trim().toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}

async function promptForTicketInput(reader: PromptReader): Promise<TicketInput> {
  printSection("Manual Ticket Entry", "Press Enter to accept the suggested defaults.");
  const ticket = await promptForRequiredText(reader, "Ticket description");
  const inferredDefaults = inferDefaults(ticket);

  printSection("Suggested Defaults");
  console.log(
    formatTicketInputSummary({
      ticket,
      customer_tier: inferredDefaults.customer_tier,
      product_area: inferredDefaults.product_area,
      account_id: inferredDefaults.account_id,
    }),
  );

  const customerTier = await promptForChoice(
    reader,
    "Customer tier",
    customerTierOptions,
    inferredDefaults.customer_tier ?? "pro",
  );
  const productArea = await promptForChoice(
    reader,
    "Product area",
    productAreaOptions,
    inferredDefaults.product_area ?? "general",
  );
  const accountId = await promptForAccountId(reader, defaultAccountIdByProductArea[productArea]);

  return ticketInputSchema.parse({
    ticket,
    customer_tier: customerTier,
    account_id: accountId,
    product_area: productArea,
  });
}

async function createPromptReader(): Promise<PromptReader> {
  if (input.isTTY) {
    return createInterface({ input, output });
  }

  let bufferedInput = "";

  for await (const chunk of input) {
    bufferedInput += chunk;
  }

  const lines = bufferedInput.split(/\r?\n/);
  let index = 0;

  return {
    close() {},
    async question(query: string): Promise<string> {
      output.write(query);

      const value = lines[index];
      if (value === undefined) {
        throw new Error("Not enough input was provided for the manual ticket CLI.");
      }

      index += 1;
      output.write(`${value}\n`);
      return value;
    },
  };
}

const options = parseCliOptions(process.argv.slice(2));
const reader = await createPromptReader();

try {
  const ticketInput = await promptForTicketInput(reader);

  printSection(
    "Prepared Input",
    options.debug ? JSON.stringify(ticketInput, null, 2) : formatTicketInputSummary(ticketInput),
  );

  if (!(await promptForConfirmation(reader))) {
    printSection("Status", style("Cancelled.", ansi.yellow, ansi.bold));
    process.exit(0);
  }

  printSection("Status", style("Running support triage...", ansi.cyan));

  const client = createBraintrustOpenAIClient();
  const run = await withTrace(
    {
      name: "support-triage-manual",
      input: ticketInput,
      metadata: buildTicketMetadata(ticketInput, { source: "manual_ticket_entry" }),
    },
    async (span) => runSupportTriageDetailed(ticketInput, { client, parentSpan: span }),
  );

  if (options.debug) {
    printSection("Input", JSON.stringify(run.input, null, 2));
    printSection(
      "Agent Context",
      JSON.stringify(
        {
          runtime_mode: run.context.runtime_mode,
          stage_prompt_modes: run.context.stage_prompt_modes,
          reviewer_overrode_draft: run.context.reviewer_overrode_draft,
          help_center_results: run.context.help_center_results,
          recent_account_events: run.context.recent_account_events,
          escalation: run.context.escalation,
        },
        null,
        2,
      ),
    );
    printSection("Stage Outputs", JSON.stringify(run.stages, null, 2));
    printSection("Result", JSON.stringify(run.result, null, 2));
  } else {
    printResultSummary(run.result);
  }
} finally {
  reader.close();
}

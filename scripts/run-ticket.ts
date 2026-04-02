import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { runSupportTriageDetailed } from "../src/app.js";
import {
  buildSupportTriageTags,
  buildTicketMetadata,
  createBraintrustOpenAIClient,
  withTrace,
} from "../src/braintrust/tracing.js";
import {
  customerTierSchema,
  productAreaSchema,
  ticketInputSchema,
  type TicketInput,
} from "../src/schemas.js";

const customerTierOptions = customerTierSchema.options;
const productAreaOptions = productAreaSchema.options;
const defaultAccountIds = ["acct_104", "acct_201", "acct_309"] as const;

type PromptReader = {
  close(): void;
  question(query: string): Promise<string>;
};

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

  if (/(api|timeout|automation|sync|throttle|request)/.test(normalized)) {
    return {
      customer_tier: "pro",
      product_area: "api",
      account_id: "acct_309",
    };
  }

  return {
    customer_tier: "pro",
    product_area: "general",
    account_id: "acct_104",
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
      return options[numericChoice - 1]!;
    }

    const exactMatch = options.find((option) => option === answer);
    if (exactMatch) {
      return exactMatch;
    }

    console.log(`Please choose one of: ${options.join(", ")}`);
  }
}

async function promptForAccountId(
  reader: PromptReader,
  defaultValue: string,
): Promise<string> {
  console.log("Account ID:");
  defaultAccountIds.forEach((accountId, index) => {
    const suffix = accountId === defaultValue ? " (default)" : "";
    console.log(`  ${index + 1}. ${accountId}${suffix}`);
  });

  const answer = (await reader.question(`Select account ID [${defaultValue}]: `)).trim();

  if (!answer) {
    return defaultValue;
  }

  const numericChoice = Number(answer);
  if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= defaultAccountIds.length) {
    return defaultAccountIds[numericChoice - 1]!;
  }

  return answer;
}

async function promptForTicketInput(reader: PromptReader): Promise<TicketInput> {
  const ticket = await promptForRequiredText(reader, "Ticket");
  const defaults = inferDefaults(ticket);

  const customerTier = await promptForChoice(
    reader,
    "Customer tier",
    customerTierOptions,
    defaults.customer_tier ?? "pro",
  );

  const productArea = await promptForChoice(
    reader,
    "Product area",
    productAreaOptions,
    defaults.product_area ?? "general",
  );

  const accountId = await promptForAccountId(reader, defaults.account_id ?? "acct_104");

  return ticketInputSchema.parse({
    ticket,
    customer_tier: customerTier,
    product_area: productArea,
    account_id: accountId,
  });
}

async function main(): Promise<void> {
  const reader = createInterface({ input, output });
  const client = createBraintrustOpenAIClient();

  try {
    const ticketInput = await promptForTicketInput(reader);
    const run = await withTrace(
      {
        name: "support-triage-manual",
        input: ticketInput,
        metadata: buildTicketMetadata(ticketInput, {
          source: "manual_ticket_cli",
          runtime_mode: "local",
        }),
        tags: buildSupportTriageTags("entrypoint:manual", "runtime_mode:local"),
      },
      async (span) => runSupportTriageDetailed(ticketInput, { client, parentSpan: span }),
    );

    console.log("");
    console.log("Input:");
    console.log(JSON.stringify(run.input, null, 2));
    console.log("");
    console.log("Context:");
    console.log(JSON.stringify(run.context, null, 2));
    console.log("");
    console.log("Stages:");
    console.log(JSON.stringify(run.stages, null, 2));
    console.log("");
    console.log("Escalation:");
    console.log(JSON.stringify(run.escalation, null, 2));
    console.log("");
    console.log("Result:");
    console.log(JSON.stringify(run.result, null, 2));
  } finally {
    reader.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import "dotenv/config";

import { runSupportTriageDetailed } from "../src/app.js";
import { type TicketInput } from "../src/schemas.js";

const demoTickets: TicketInput[] = [
  {
    ticket: "Our finance admin can no longer export invoices after upgrading to Enterprise. This is blocking close today.",
    customer_tier: "enterprise",
    account_id: "acct_104",
    product_area: "billing",
  },
  {
    ticket: "SSO login is failing for several admins after we changed our company domain yesterday.",
    customer_tier: "enterprise",
    account_id: "acct_201",
    product_area: "auth",
  },
];

async function main(): Promise<void> {
  for (const input of demoTickets) {
    const run = await runSupportTriageDetailed(input);
    console.log("Input:");
    console.log(JSON.stringify(run.input, null, 2));
    console.log("Context:");
    console.log(JSON.stringify(run.context, null, 2));
    console.log("Stages:");
    console.log(JSON.stringify(run.stages, null, 2));
    console.log("Escalation:");
    console.log(JSON.stringify(run.escalation, null, 2));
    console.log("Result:");
    console.log(JSON.stringify(run.result, null, 2));
    console.log("---");
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

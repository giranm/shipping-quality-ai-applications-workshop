import "dotenv/config";

import { readFile } from "node:fs/promises";

import { runSupportTriageDetailed } from "../src/app.js";
import {
  buildTicketMetadata,
  createBraintrustOpenAIClient,
  withTrace,
} from "../src/braintrust/tracing.js";
import { ticketInputSchema, type TicketInput } from "../src/schemas.js";

async function loadDemoTickets(): Promise<TicketInput[]> {
  const raw = await readFile(new URL("../data/tickets.demo.jsonl", import.meta.url), "utf8");

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ticketInputSchema.parse(JSON.parse(line)));
}

const client = createBraintrustOpenAIClient();

for (const input of await loadDemoTickets()) {
  const run = await withTrace(
    {
      name: "support-triage-demo",
      input,
      metadata: buildTicketMetadata(input, { source: "demo_script" }),
    },
    async (span) => runSupportTriageDetailed(input, { client, parentSpan: span }),
  );
  console.log("Input:");
  console.log(JSON.stringify(run.input, null, 2));
  console.log("Agent context:");
  console.log(
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
  console.log("Stage outputs:");
  console.log(JSON.stringify(run.stages, null, 2));
  console.log("Result:");
  console.log(JSON.stringify(run.result, null, 2));
  console.log("---");
}

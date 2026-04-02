import "dotenv/config";

import { getRuntimeMode, runSupportTriageDetailed } from "../src/app.js";
import { loadProdFailureRows } from "../src/braintrust/dataset.js";
import {
  buildSupportTriageTags,
  buildTicketMetadata,
  createBraintrustOpenAIClient,
  withTrace,
} from "../src/braintrust/tracing.js";

function getFailureMatchTerm(argv: string[]): string | undefined {
  const flagIndex = argv.indexOf("--match");
  if (flagIndex >= 0) {
    return argv[flagIndex + 1];
  }

  return process.env.FAILURE_MATCH;
}

const failureMatch = getFailureMatchTerm(process.argv.slice(2))?.trim().toLowerCase();
const failures = (await loadProdFailureRows()).filter((input) => {
  if (!failureMatch) {
    return true;
  }

  return JSON.stringify(input).toLowerCase().includes(failureMatch);
});

if (failures.length === 0) {
  throw new Error(
    `No failure replay rows matched ${JSON.stringify(failureMatch)}. Use FAILURE_MATCH or --match to filter by ticket text or account id.`,
  );
}

const client = createBraintrustOpenAIClient();
const runtimeMode = getRuntimeMode();

console.log(
  `Replaying ${failures.length} failure case(s)${failureMatch ? ` matching ${JSON.stringify(failureMatch)}` : ""}.`,
);

for (const input of failures) {
  const run = await withTrace(
    {
      name: "replay-prod-failure",
      input,
      metadata: buildTicketMetadata(input, {
        source: "prod_failure_replay",
        runtime_mode: runtimeMode,
      }),
      tags: buildSupportTriageTags("entrypoint:replay-failure", `runtime_mode:${runtimeMode}`),
    },
    async (span) =>
      runSupportTriageDetailed(input, {
        client,
        parentSpan: span,
        runtimeMode,
      }),
  );

  console.log("Failure replay input:");
  console.log(JSON.stringify(run.input, null, 2));
  console.log("Failure replay context:");
  console.log(
    JSON.stringify(
      {
        runtime_mode: run.context.runtime_mode,
        stage_prompt_modes: run.context.stage_prompt_modes,
        help_center_results: run.context.help_center_results,
        recent_account_events: run.context.recent_account_events,
      },
      null,
      2,
    ),
  );
  console.log("Failure replay stage outputs:");
  console.log(JSON.stringify(run.stages, null, 2));
  console.log("Failure replay result:");
  console.log(JSON.stringify(run.result, null, 2));
  console.log("---");
}

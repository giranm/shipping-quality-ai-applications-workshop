# Shipping Complex AI Applications with Braintrust

Checkpoint: `09b-remediation`

This branch applies the remediation loop on top of the failure replay work:
1) isolate a failure trace, 2) target a scenario in evals, 3) tune prompts, 4) re-run evals to confirm improvement.

## What exists here

- local help-center search in `src/tools.ts`
- local account-event lookup in `src/tools.ts`
- deterministic escalation creation in `src/tools.ts`
- explicit workflow stages under `src/workflow/`
- Braintrust tracing helpers in `src/braintrust/tracing.ts`
- traced app orchestration in `src/app.ts`
- consistent root/stage/tool metadata and tags across the runtime path
- seeded dataset rows in `data/evals.seed.jsonl`
- dataset upload in `src/braintrust/dataset.ts` and `scripts/seed-dataset.ts`
- offline eval runner in `src/braintrust/evals.ts`
- deterministic scorers in `src/braintrust/scorers.ts`
- Braintrust prompt bootstrap in `src/braintrust/prompts.ts`
- Braintrust runtime parameter bootstrap/loading in `src/braintrust/parameters.ts`
- Braintrust managed tool bootstrap in `src/braintrust/tools.ts`
- managed triage tool loop support in `src/braintrust/managed-tools.ts`
- remote scorer bootstrap in `src/braintrust/remote-scorers.ts`
- shared scorer logic in `src/braintrust/scorer-logic.ts`
- online scoring rule bootstrap in `src/braintrust/online-rules.ts`
- runtime metadata logging on managed tool/scorer spans
- production failure fixture rows in `data/prod_failures.jsonl`
- failure replay runner in `scripts/replay-failure.ts`
- eval filters in `src/braintrust/evals.ts` (`EVAL_SCENARIO`, `EVAL_MATCH`, `--scenario`, `--match`)
- scenario-aware experiment naming for Braintrust eval runs
- reviewer/reply prompt calibration updates in `src/prompts.ts`
- Braintrust setup entrypoint in `scripts/setup-braintrust.ts`
- managed runtime path in `src/app.ts` and `src/workflow/`
- demo and ticket scripts that create root traces and show context, stage outputs, and escalation

## Phase 09 refs

- `workshop/09a-prod-failure` / `09a-prod-failure`: replay-only failure checkpoint
- `workshop/09b-remediation` / `09b-remediation`: remediation checkpoint (this branch)
- `workshop/09-prod-failure-and-remediation` / `09-prod-failure-and-remediation`: alias to remediation state

## Run

```bash
make setup
make setup-braintrust
make demo
make seed-dataset
make eval
make replay-failure
make ticket
RUNTIME_MODE=managed make demo
RUNTIME_MODE=managed FAILURE_MATCH="board reporting" make replay-failure
RUNTIME_MODE=managed EVAL_SCENARIO=calm_wording_high_impact make eval
```

`make demo` and `make ticket` still work with only `OPENAI_API_KEY`.

If you also set `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT`:
- `make demo` and `make ticket` emit root, stage, and tool traces to Braintrust
- `make seed-dataset` uploads `Helpr Seed Dataset`
- `make eval` logs a Braintrust experiment for the full staged run

To run remediation in this phase:
- run `make setup-braintrust` once to publish prompts, parameters, tools, scorers, and online scoring rules
- run one failure replay case with `FAILURE_MATCH` to isolate the trace
- run one targeted eval with `EVAL_SCENARIO`
- run the full eval set again to check for regressions

If you change prompt or parameter definitions in code and want to refresh the remote objects, use:

```bash
BRAINTRUST_IF_EXISTS=replace make setup-braintrust
```

Without Braintrust configured:
- `make eval` falls back to a local score summary instead of creating a remote experiment

## Pseudocode

```ts
setupBraintrust({
  prompts: ["helpr-triage-specialist", "helpr-policy-reviewer", "helpr-reply-writer"],
  parameters: ["helpr-runtime-config"],
  tools: ["helpr-search-help-center", "helpr-lookup-recent-account-events", "helpr-create-escalation"],
  scorers: ["helpr-schema-valid", "helpr-customer-reply-rubric", "helpr-root-triage-quality-judge", "..."],
  onlineRules: ["helpr-root-quality-online", "helpr-reply-quality-online", "helpr-stage-structure-online"],
});

for (failureTicket of prodFailures.filter(match("board reporting"))) {
  runSupportTriage(failureTicket, {
    runtimeMode: "managed",
    model: loadParameters("helpr-runtime-config").model,
  });
  inspectTrace("replay-prod-failure");
}

tunePrompt("helpr-policy-reviewer");

runEval({
  runtimeMode: "managed",
  scenario: "calm_wording_high_impact",
});

runEval({
  runtimeMode: "managed",
});
```

## Next checkpoint

Move to `10-final` to freeze workshop output and publish the curated path.

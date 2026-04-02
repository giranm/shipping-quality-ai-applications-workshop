# Shipping Quality AI Applications with Braintrust

Checkpoint: `08-online-scoring`

This branch adds managed remote scorers and online scoring rules so live traces are scored in Braintrust as they arrive. Prompts, parameters, and tools remain managed from the previous checkpoint.

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
- Braintrust setup entrypoint in `scripts/setup-braintrust.ts`
- managed runtime path in `src/app.ts` and `src/workflow/`
- demo and ticket scripts that create root traces and show context, stage outputs, and escalation

## What is intentionally missing

- no production failure replay/remediation flow yet

## Run

```bash
make setup
make setup-braintrust
make demo
make seed-dataset
make eval
make ticket
RUNTIME_MODE=managed make demo
```

`make demo` and `make ticket` still work with only `OPENAI_API_KEY`.

If you also set `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT`:
- `make demo` and `make ticket` emit root, stage, and tool traces to Braintrust
- `make seed-dataset` uploads `Helpr Seed Dataset`
- `make eval` logs a Braintrust experiment for the full staged run

To run the managed path in this phase:
- run `make setup-braintrust` once to publish prompts, parameters, tools, scorers, and online scoring rules
- then run `RUNTIME_MODE=managed make demo`

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

runSupportTriage(input, {
  runtimeMode: "managed",
  model: loadParameters("helpr-runtime-config").model,
});

triageDraft = runManagedPromptWithTools("helpr-triage-specialist");
reviewed = runManagedPrompt("helpr-policy-reviewer");
reply = runManagedPrompt("helpr-reply-writer");
if (reviewed.should_escalate) {
  invokeManagedTool("helpr-create-escalation");
}
scoreOnline({
  rootSpan: "support-triage-*",
  stageSpans: ["triage-specialist", "policy-reviewer", "reply-writer"],
});
```

## Next checkpoint

Move to `09-prod-failure-and-remediation` to add failure replay and a remediation loop.

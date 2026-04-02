# Shipping Quality AI Applications with Braintrust

Checkpoint: `07-managed-tools`

This branch moves the retrieval and escalation tools into Braintrust while keeping prompts and runtime parameters managed from the previous checkpoint. In managed mode, `collect-context` now invokes Braintrust-managed retrieval tools and `finalize-result` invokes a managed escalation tool deterministically after the reviewer approves escalation.

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
- Braintrust setup entrypoint in `scripts/setup-braintrust.ts`
- managed runtime path in `src/app.ts` and `src/workflow/`
- demo and ticket scripts that create root traces and show context, stage outputs, and escalation

## What is intentionally missing

- no remote scorers or online scoring

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
- run `make setup-braintrust` once to publish the three prompt slugs, `helpr-runtime-config`, and the managed tool slugs
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
```

## Next checkpoint

Move to `08-online-scoring` to add remote scorers and automations that evaluate live traces.

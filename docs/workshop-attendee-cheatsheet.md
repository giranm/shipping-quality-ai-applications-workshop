# Workshop Attendee Cheatsheet

**Author:** [Giran Moodley](https://www.linkedin.com/in/giran/)  
**Last revised:** 2026-04-07  
**Repository:** [giranm/shipping-quality-ai-applications-workshop](https://github.com/giranm/shipping-quality-ai-applications-workshop)

This guide provides a step-by-step reference for workshop attendees to follow during the session and use to catch up independently if needed.

## What This Workshop Is About

In this workshop, you will build and improve a support triage AI application called `Helpr`.

The goal is not just to get a demo working. The goal is to learn how to ship a higher-quality AI application with:

- deterministic tools and staged model decisions
- Braintrust tracing for observability
- datasets and evals for safer iteration
- managed prompts, tools, and parameters for deployment
- production-failure replay and remediation

By the end of the workshop, you should understand the full loop:

1. build the workflow
2. observe what happened in traces
3. evaluate quality with datasets and scorers
4. deploy changes through managed Braintrust objects
5. turn real failures into regression tests

This cheatsheet focuses on getting you unblocked quickly so you can rejoin the live workshop at any point.

Use it as a step-by-step recovery path:

1. create the required accounts and API keys
2. clone the repo and install dependencies
3. configure your environment
4. bootstrap Braintrust-managed objects
5. run the app locally and in managed mode
6. inspect traces, prompts, parameters, and scores in Braintrust
7. jump to the correct workshop checkpoint if needed

## 1. Before You Start

You need:

- a Braintrust account
- a Braintrust API key
- an OpenAI API key
- Git installed
- a terminal
- `mise` installed

### 1.1 Create a Braintrust account

Go to `https://www.braintrust.dev/` and create an account.

[Add screenshot: Braintrust sign-up or home page]

### 1.2 Create a Braintrust API key

Open:

- `https://www.braintrust.dev/settings`

Create a new API key and keep it available for your `.env` file.

[Add screenshot: Braintrust API key screen]

### 1.3 Create an OpenAI API key

Open:

- `https://platform.openai.com/api-keys`

Create an API key and keep it available for your `.env` file.

[Add screenshot: OpenAI API key screen]

## 2. Clone The Repo

Clone the workshop repository:

```bash
git clone <WORKSHOP_REPO_URL>
cd shipping-quality-ai-applications-workshop
```

If you were given a specific workshop branch or tag, you can switch later. Start on the default branch first unless instructed otherwise.

## 3. Install Local Tooling

Run:

```bash
mise trust
mise install
make setup
```

What this does:

- trusts the repo-local `mise` configuration
- installs the required runtimes
- installs project dependencies with `pnpm`

Expected result:

- dependencies install successfully
- you can run the workshop `make` commands locally

If `make setup` fails, fix that first before moving on.

## 4. Configure Your Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and set at least:

```bash
OPENAI_API_KEY=...
BRAINTRUST_API_KEY=...
BRAINTRUST_PROJECT=helpr-workshop
BRAINTRUST_PROMPT_IF_EXISTS=ignore
RUNTIME_MODE=local
OPENAI_MODEL=gpt-5-mini
```

Notes:

- `BRAINTRUST_PROJECT` is the shared Braintrust project name used for traces, prompts, tools, parameters, datasets, evals, scorers, and automation rules.
- `RUNTIME_MODE=local` is the safest place to start.
- `OPENAI_MODEL=gpt-5-mini` is the baseline local default used by the repo.

## 5. Core Rule: Run `make setup-braintrust`

This command is core to the workshop.

Run it once after your local setup, and rerun it whenever the workshop asks you to work with managed Braintrust objects.

```bash
make setup-braintrust
```

This bootstraps the Braintrust project with repo-owned objects, including:

- managed prompts
- managed tools
- the `helpr-runtime-config` parameter object
- remote scorers
- online scoring rules

Why this matters:

- managed mode depends on these objects existing remotely
- later workshop phases assume the project has already been bootstrapped
- if prompts, tools, scorers, or automation rules are updated in code, rerun this command so Braintrust stays in sync

If you explicitly need to refresh the remote objects from code, run:

```bash
BRAINTRUST_IF_EXISTS=replace make setup-braintrust
```

Use `replace` only when the workshop instructs you to refresh remote objects or when you know the code-defined Braintrust objects changed.

Expected result:

- the command reports that prompts, tools, parameters, scorers, and online rules were bootstrapped
- the configured Braintrust project now contains the managed objects needed for later phases

[Add screenshot: Braintrust project after setup-braintrust showing prompts/tools/parameters]

## 6. Sanity-Check The App In Local Mode

Run the demo tickets first:

```bash
RUNTIME_MODE=local make demo
```

Then try the interactive flow:

```bash
RUNTIME_MODE=local make ticket
```

What to expect:

- the app prints stage-by-stage output in the terminal
- you get a final structured triage result
- a Braintrust trace should be recorded for the run

[Add screenshot: Terminal output for a successful local run]
[Add screenshot: Braintrust trace list showing a local run]

## 7. Run In Managed Mode

After `make setup-braintrust` succeeds, switch to managed mode:

```bash
RUNTIME_MODE=managed make demo
```

You can also run the interactive flow:

```bash
RUNTIME_MODE=managed make ticket
```

Managed mode means:

- prompts are loaded from Braintrust
- managed tools are used where configured
- the runtime model is controlled by the Braintrust parameter object
- online scorers and automation rules can attach quality signals to traces

If managed mode fails, the most common cause is that `make setup-braintrust` has not been run yet, or was not rerun after object changes.

[Add screenshot: Braintrust trace tree for a managed run]
[Add screenshot: Prompt detail page in Braintrust]
[Add screenshot: Runtime parameter page for helpr-runtime-config]

## 8. Braintrust UI: What To Check

Keep these Braintrust screens open during the workshop:

- Logs
- Prompts
- Tools
- Parameters
- Datasets
- Experiments

Use them like this:

### 8.1 Logs

Open the latest trace and read it top to bottom:

1. root span
2. `collect-context`
3. `triage-specialist`
4. `policy-reviewer`
5. `reply-writer`
6. `finalize-result`

[Add screenshot: Trace tree view]

### 8.2 Prompts

Use this screen when the workshop edits or reviews staged prompts.

You should see managed prompt slugs such as:

- `helpr-triage-specialist`
- `helpr-policy-reviewer`
- `helpr-reply-writer`

[Add screenshot: Prompt object detail page]

### 8.3 Tools

Use this screen to inspect the managed tool definitions used by the staged workflow.

[Add screenshot: Managed tools page]

### 8.4 Parameters

Use this screen to inspect or change:

- `helpr-runtime-config`

This parameter controls the managed runtime model.

[Add screenshot: Parameter object detail page]

### 8.5 Datasets And Experiments

Use these screens during the eval phases:

- dataset seeding
- offline eval runs
- comparison between eval experiments

[Add screenshot: Seed dataset page]
[Add screenshot: Experiments page]

### 8.6 Online Scores

In managed mode, traces can also show online scorer output on the relevant spans.

[Add screenshot: Trace with online scoring spans]

## 9. Catch-Up Commands

If you fall behind, these commands are the fastest recovery path.

### 9.1 Reinstall everything

```bash
mise trust
mise install
make setup
```

### 9.2 Re-sync Braintrust objects

```bash
make setup-braintrust
```

If the workshop has updated managed objects and you need to force-refresh them:

```bash
BRAINTRUST_IF_EXISTS=replace make setup-braintrust
```

### 9.3 Run a quick sanity check

```bash
RUNTIME_MODE=local make demo
RUNTIME_MODE=managed make demo
```

### 9.4 Run the interactive ticket flow

```bash
make ticket
```

If you want to be explicit:

```bash
RUNTIME_MODE=local make ticket
RUNTIME_MODE=managed make ticket
```

### 9.5 Seed the dataset and run evals

```bash
make seed-dataset
make eval
```

To run managed evals explicitly:

```bash
RUNTIME_MODE=managed make eval
```

### 9.6 Replay the production-style failure case

```bash
make replay-failure
```

Or:

```bash
RUNTIME_MODE=managed FAILURE_MATCH="board reporting" make replay-failure
```

## 10. Catch Up By Jumping To A Checkpoint

Every workshop checkpoint is a fully runnable repo state.

You can jump straight to a checkpoint:

```bash
git checkout workshop/<checkpoint>
```

Common checkpoints:

- `workshop/00-starter`
- `workshop/01-basic-agent`
- `workshop/02-add-local-tools`
- `workshop/03-specialist-stages`
- `workshop/04-add-tracing`
- `workshop/05-add-dataset-and-evals`
- `workshop/06-managed-prompts-and-parameters`
- `workshop/07-managed-tools`
- `workshop/08-online-scoring`
- `workshop/09a-prod-failure`
- `workshop/09b-remediation`
- `workshop/10-final`

Important:

- after switching checkpoints, rerun any setup command the workshop asks for
- if the checkpoint uses managed Braintrust objects, rerun `make setup-braintrust`

## 11. Common Problems

### Problem: `make setup` fails

Likely cause:

- `mise` is not installed
- local runtimes were not installed yet
- dependency installation failed

Fix:

```bash
mise trust
mise install
make setup
```

### Problem: managed mode fails immediately

Likely cause:

- you did not run `make setup-braintrust`
- your Braintrust project name is wrong
- the managed objects were not refreshed after code changes

Fix:

```bash
make setup-braintrust
```

If needed:

```bash
BRAINTRUST_IF_EXISTS=replace make setup-braintrust
```

### Problem: no traces appear in Braintrust

Likely cause:

- missing `BRAINTRUST_API_KEY`
- wrong `BRAINTRUST_PROJECT`
- the run failed before the trace completed

Check:

- your `.env` file
- the terminal output
- the correct Braintrust project in the UI

### Problem: Braintrust UI does not show the expected prompt or parameter

Likely cause:

- wrong project selected in the UI
- `make setup-braintrust` has not been run yet
- remote objects need to be refreshed

Fix:

```bash
make setup-braintrust
```

Or, if the workshop explicitly needs a refresh:

```bash
BRAINTRUST_IF_EXISTS=replace make setup-braintrust
```

## 12. Minimal Recovery Path

If you are completely stuck, do this in order:

```bash
mise trust
mise install
make setup
cp .env.example .env
```

Fill in your API keys, then run:

```bash
make setup-braintrust
RUNTIME_MODE=local make demo
RUNTIME_MODE=managed make demo
```

If that works, you are caught up enough to continue.

import "dotenv/config";

import { Eval } from "braintrust";
import { fileURLToPath } from "node:url";

import { runSupportTriage } from "../app.js";
import type { TicketInput, TriageResult } from "../schemas.js";
import { getBraintrustDatasetName, requireBraintrustProjectName } from "./config.js";
import { type EvalExpected, type EvalRow, loadSeedEvalRows } from "./dataset.js";
import { triageScorers } from "./scorers.js";
import { createBraintrustOpenAIClient, isBraintrustEnabled } from "./tracing.js";

type LocalEvalRowResult = {
  input: TicketInput;
  output: TriageResult | null;
  scores: Record<string, number | null>;
  error: string | null;
};

type NamedScore = {
  name: string;
  score: number | null;
  metadata?: Record<string, unknown>;
};

const seedEvalBaseName = "helpr-seed-eval";

type SeedEvalFilters = {
  match?: string;
  scenario?: string;
};

function normalizeScores(result: number | null | NamedScore | NamedScore[]): NamedScore[] {
  if (Array.isArray(result)) {
    return result;
  }

  if (typeof result === "number" || result === null) {
    return [{ name: "score", score: result }];
  }

  return [result];
}

async function scoreRow(row: EvalRow, output: TriageResult): Promise<Record<string, number | null>> {
  const scores: Record<string, number | null> = {};

  for (const scorer of triageScorers) {
    const result = await scorer({
      input: row.input,
      expected: row.expected,
      metadata: row.metadata,
      output,
    });

    for (const item of normalizeScores(result)) {
      scores[item.name] = item.score;
    }
  }

  return scores;
}

function summarize(results: LocalEvalRowResult[]) {
  const totals = new Map<string, { total: number; count: number }>();

  for (const result of results) {
    for (const [name, value] of Object.entries(result.scores)) {
      if (value === null) {
        continue;
      }

      const current = totals.get(name) ?? { total: 0, count: 0 };
      current.total += value;
      current.count += 1;
      totals.set(name, current);
    }
  }

  return Object.fromEntries(
    [...totals.entries()].map(([name, value]) => [name, Number((value.total / value.count).toFixed(3))]),
  );
}

function summarizeCaseMix(rows: EvalRow[]) {
  const byDifficulty: Record<string, number> = {};
  const byScenario: Record<string, number> = {};
  const flags = {
    hidden_urgency_impact: 0,
    conflicting_signals_case: 0,
    low_context_case: 0,
    reviewer_override_expected: 0,
  };

  for (const row of rows) {
    const difficulty = typeof row.metadata.difficulty === "string" ? row.metadata.difficulty : "unknown";
    byDifficulty[difficulty] = (byDifficulty[difficulty] ?? 0) + 1;

    const scenario = typeof row.metadata.scenario === "string" ? row.metadata.scenario : "unspecified";
    byScenario[scenario] = (byScenario[scenario] ?? 0) + 1;

    for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
      if (row.metadata[key] === true) {
        flags[key] += 1;
      }
    }
  }

  return {
    by_difficulty: byDifficulty,
    by_scenario: byScenario,
    flags,
  };
}

function formatExperimentTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hour}${minute}${second}z`;
}

function slugifyExperimentPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function buildSeedEvalExperimentName(filters: SeedEvalFilters): string {
  const runtimeMode = (process.env.RUNTIME_MODE ?? "local").toLowerCase();
  const filterPart = filters.scenario
    ? `-${slugifyExperimentPart(filters.scenario)}`
    : filters.match
      ? `-match-${slugifyExperimentPart(filters.match)}`
      : "";

  return `${seedEvalBaseName}-${runtimeMode}${filterPart}-${formatExperimentTimestamp(new Date())}`;
}

function normalizeFilterValue(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function getSeedEvalFilters(): SeedEvalFilters {
  const argv = process.argv.slice(2);
  const scenarioFlagIndex = argv.indexOf("--scenario");
  const matchFlagIndex = argv.indexOf("--match");

  return {
    scenario:
      normalizeFilterValue(scenarioFlagIndex >= 0 ? argv[scenarioFlagIndex + 1] : undefined) ??
      normalizeFilterValue(process.env.EVAL_SCENARIO),
    match:
      normalizeFilterValue(matchFlagIndex >= 0 ? argv[matchFlagIndex + 1] : undefined) ??
      normalizeFilterValue(process.env.EVAL_MATCH),
  };
}

function filterSeedEvalRows(rows: EvalRow[], filters: SeedEvalFilters): EvalRow[] {
  return rows.filter((row) => {
    if (filters.scenario) {
      const scenario = typeof row.metadata.scenario === "string" ? row.metadata.scenario : "";
      if (scenario !== filters.scenario) {
        return false;
      }
    }

    if (filters.match) {
      const haystack = JSON.stringify(row).toLowerCase();
      if (!haystack.includes(filters.match.toLowerCase())) {
        return false;
      }
    }

    return true;
  });
}

async function runLocalEvaluation(rows: EvalRow[]) {
  const client = createBraintrustOpenAIClient();
  const results: LocalEvalRowResult[] = [];

  for (const row of rows) {
    try {
      const output = await runSupportTriage(row.input, { client });
      const scores = await scoreRow(row, output);
      results.push({
        input: row.input,
        output,
        scores,
        error: null,
      });
    } catch (error) {
      results.push({
        input: row.input,
        output: null,
        scores: {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    rows: results,
    summary: summarize(results),
    caseMix: summarizeCaseMix(rows),
  };
}

export async function runSeedEvaluation() {
  const filters = getSeedEvalFilters();
  const rows = filterSeedEvalRows(await loadSeedEvalRows(), filters);

  if (rows.length === 0) {
    throw new Error(
      `No eval rows matched the requested filters: ${JSON.stringify(filters)}. Use EVAL_SCENARIO or EVAL_MATCH to narrow the eval set.`,
    );
  }

  if (!isBraintrustEnabled()) {
    return {
      mode: "local" as const,
      ...(await runLocalEvaluation(rows)),
    };
  }

  const client = createBraintrustOpenAIClient();
  const caseMix = summarizeCaseMix(rows);
  const projectName = requireBraintrustProjectName();
  const experimentName = buildSeedEvalExperimentName(filters);
  const result = await Eval<TicketInput, TriageResult, EvalExpected, Record<string, unknown>>(
    projectName,
    {
      data: rows,
      task: async (input) => runSupportTriage(input, { client }),
      scores: triageScorers,
      experimentName,
      metadata: {
        eval_name: seedEvalBaseName,
        dataset: getBraintrustDatasetName(),
        cases: rows.length,
        case_mix: caseMix,
        runtime_mode: process.env.RUNTIME_MODE ?? "local",
        filters,
      },
    },
  );

  return {
    mode: "braintrust" as const,
    result,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const evaluation = await runSeedEvaluation();

  if (evaluation.mode === "local") {
    console.log("Ran local eval fallback.");
    console.log(JSON.stringify({ case_mix: evaluation.caseMix, scores: evaluation.summary }, null, 2));
  } else {
    console.log("Ran Braintrust eval experiment.");
    console.log(JSON.stringify(evaluation.result.summary, null, 2));
  }
}

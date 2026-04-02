import "dotenv/config";

import { currentSpan, Eval } from "braintrust";
import { fileURLToPath } from "node:url";

import { getRuntimeMode, runSupportTriage, runSupportTriageDetailed } from "../app.js";
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
      tags: undefined,
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

async function runLocalEvaluation(rows: EvalRow[]) {
  const client = createBraintrustOpenAIClient();
  const runtimeMode = getRuntimeMode();
  const results: LocalEvalRowResult[] = [];

  for (const row of rows) {
    try {
      const output = await runSupportTriage(row.input, {
        client,
        parentSpan: currentSpan(),
        runtimeMode,
      });
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
  };
}

export async function runSeedEvaluation() {
  const rows = await loadSeedEvalRows();
  const runtimeMode = getRuntimeMode();

  if (!isBraintrustEnabled()) {
    return {
      mode: "local" as const,
      ...(await runLocalEvaluation(rows)),
    };
  }

  const client = createBraintrustOpenAIClient();
  const result = await Eval<TicketInput, TriageResult, EvalExpected, Record<string, unknown>>(
    requireBraintrustProjectName(),
    {
      data: rows,
      task: async (input) =>
        (
          await runSupportTriageDetailed(input, {
            client,
            parentSpan: currentSpan(),
            runtimeMode,
          })
        ).result,
      scores: triageScorers,
      experimentName: `helpr-seed-eval-${runtimeMode}`,
      metadata: {
        dataset: getBraintrustDatasetName(),
        cases: rows.length,
        runtime_mode: runtimeMode,
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
    console.log(JSON.stringify(evaluation.summary, null, 2));
  } else {
    console.log("Ran Braintrust eval experiment.");
    console.log(JSON.stringify(evaluation.result.summary, null, 2));
  }
}

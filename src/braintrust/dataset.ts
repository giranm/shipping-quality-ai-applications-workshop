import { readFile } from "node:fs/promises";

import { initDataset } from "braintrust";
import { z } from "zod";

import { ticketInputSchema, triageResultSchema, type TicketInput } from "../schemas.js";
import { getBraintrustDatasetName, getBraintrustProjectName } from "./config.js";

const evalExpectedSchema = triageResultSchema.pick({
  category: true,
  severity: true,
  should_escalate: true,
});

const evalRowSchema = z.object({
  id: z.string().min(1),
  input: ticketInputSchema,
  expected: evalExpectedSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type EvalExpected = z.infer<typeof evalExpectedSchema>;
export type EvalRow = z.infer<typeof evalRowSchema>;

async function loadJsonlFile<T>(file: URL, schema: z.ZodType<T>): Promise<T[]> {
  const raw = await readFile(file, "utf8");

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => schema.parse(JSON.parse(line)));
}

export async function loadSeedEvalRows(
  file: URL = new URL("../../data/evals.seed.jsonl", import.meta.url),
): Promise<EvalRow[]> {
  return loadJsonlFile(file, evalRowSchema);
}

export async function loadProdFailureRows(
  file: URL = new URL("../../data/prod_failures.jsonl", import.meta.url),
): Promise<TicketInput[]> {
  return loadJsonlFile(file, ticketInputSchema);
}

export async function seedBraintrustDataset(rows: EvalRow[]) {
  const projectName = getBraintrustProjectName();

  if (!process.env.BRAINTRUST_API_KEY || !projectName) {
    return {
      uploaded: 0,
      skipped: true as const,
    };
  }

  const dataset = initDataset({
    project: projectName,
    dataset: getBraintrustDatasetName(),
    apiKey: process.env.BRAINTRUST_API_KEY,
  });

  for (const row of rows) {
    dataset.insert({
      id: row.id,
      input: row.input,
      expected: row.expected,
      metadata: row.metadata,
      tags: ["helpr", "seed", `difficulty:${String(row.metadata.difficulty ?? "unknown")}`],
    });
  }

  await dataset.flush();

  return {
    uploaded: rows.length,
    skipped: false as const,
    summary: await dataset.summarize(),
  };
}

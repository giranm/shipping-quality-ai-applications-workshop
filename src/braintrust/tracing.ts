import { flush, initLogger, startSpan, withCurrent, wrapOpenAI, type Span } from "braintrust";
import OpenAI from "openai";

import type { TicketInput } from "../schemas.js";

let loggerInitialized = false;

type SpanArgs = {
  name: string;
  type?: "task" | "tool";
  input?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
};

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

export function isBraintrustEnabled(): boolean {
  return Boolean(process.env.BRAINTRUST_API_KEY && process.env.BRAINTRUST_PROJECT);
}

function ensureLogger(): boolean {
  if (!isBraintrustEnabled()) {
    return false;
  }

  if (!loggerInitialized) {
    initLogger({
      projectName: process.env.BRAINTRUST_PROJECT,
      apiKey: process.env.BRAINTRUST_API_KEY,
      asyncFlush: false,
    });
    loggerInitialized = true;
  }

  return true;
}

export function createBraintrustOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return ensureLogger() ? wrapOpenAI(client) : client;
}

export function buildTicketMetadata(input: TicketInput, extra: Record<string, unknown> = {}) {
  return {
    account_id: input.account_id ?? null,
    customer_tier: input.customer_tier ?? null,
    product_area: input.product_area ?? null,
    ...extra,
  };
}

export function buildSupportTriageTags(...tags: string[]): string[] {
  return [...new Set(["helpr", "workflow:support-triage", ...tags].filter(Boolean))];
}

export async function withTrace<T>(
  args: SpanArgs,
  callback: (span: Span | null) => Promise<T>,
): Promise<T> {
  if (!ensureLogger()) {
    return callback(null);
  }

  const span = startSpan({
    name: args.name,
    type: "task",
    event: {
      input: args.input,
      metadata: args.metadata,
      tags: args.tags,
    },
  });

  try {
    const output = await withCurrent(span, () => callback(span));
    span.log({ output });
    return output;
  } catch (error) {
    span.log({
      metadata: {
        ...args.metadata,
        error: serializeError(error),
      },
    });
    throw error;
  } finally {
    span.end();
    await flush();
  }
}

export async function withChildSpan<T>(
  parent: Span | null | undefined,
  args: SpanArgs,
  callback: (span: Span | null) => Promise<T> | T,
): Promise<T> {
  if (!parent) {
    return await callback(null);
  }

  return await parent.traced(async (span) => {
    try {
      const output = await withCurrent(span, () => callback(span));
      span.log({ output });
      return output;
    } catch (error) {
      span.log({
        metadata: {
          ...args.metadata,
          error: serializeError(error),
        },
      });
      throw error;
    }
  }, {
    name: args.name,
    type: args.type ?? "task",
    event: {
      input: args.input,
      metadata: args.metadata,
      tags: args.tags,
    },
  });
}

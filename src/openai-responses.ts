import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions";
import type { FunctionTool, ResponseInputItem } from "openai/resources/responses/responses";
import { z } from "zod";

type StructuredResponseArgs<Schema extends z.ZodTypeAny> = {
  client: OpenAI;
  messages: ChatCompletionMessageParam[];
  model: string;
  schema: Schema;
  schemaName: string;
};

function extractTextContent(
  content: string | Array<{ type?: string; text?: string }> | null | undefined,
): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n");
  }

  return "";
}

export function chatMessagesToResponseInput(messages: ChatCompletionMessageParam[]): ResponseInputItem[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      throw new Error("Tool-role messages are not supported in phase 06.");
    }

    const role = message.role === "function" ? "assistant" : message.role;
    const text =
      "content" in message
        ? extractTextContent(
            message.content as string | Array<{ type?: string; text?: string }> | null | undefined,
          )
        : "";

    return {
      type: "message",
      role,
      content: [
        {
          type: "input_text",
          text,
        },
      ],
    };
  });
}

export function chatToolsToResponseTools(tools: ChatCompletionTool[]): FunctionTool[] {
  return tools.map((tool) => {
    if (tool.type !== "function") {
      throw new Error(`Unsupported chat tool type ${tool.type}.`);
    }

    const functionTool = tool as ChatCompletionFunctionTool;

    return {
      type: "function",
      name: functionTool.function.name,
      description: functionTool.function.description,
      parameters: functionTool.function.parameters ?? null,
      strict: functionTool.function.strict ?? true,
    };
  });
}

export async function parseStructuredResponse<Schema extends z.ZodTypeAny>(
  args: StructuredResponseArgs<Schema>,
): Promise<z.infer<Schema>> {
  const response = await args.client.responses.parse({
    model: args.model,
    input: chatMessagesToResponseInput(args.messages),
    text: {
      format: zodTextFormat(args.schema, args.schemaName),
    },
  });

  if (!response.output_parsed) {
    throw new Error(`Structured response ${args.schemaName} returned no parsed output.`);
  }

  return args.schema.parse(response.output_parsed);
}

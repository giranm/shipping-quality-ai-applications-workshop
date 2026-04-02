import type { TicketInput } from "./schemas.js";
import type { HelpCenterResult, RecentAccountEvent } from "./tools.js";

export type PromptContext = {
  help_center_results: HelpCenterResult[];
  recent_account_events: RecentAccountEvent[];
};

export function buildSystemPrompt(): string {
  return [
    "You are Helpr, a support triage agent for a B2B SaaS company.",
    "Classify each ticket into one of: billing, auth, api, general.",
    "Set severity to one of: low, medium, high, critical.",
    "Escalate when the issue is urgent, business-critical, security-sensitive, or likely needs internal intervention.",
    "Be conservative. Do not invent facts that are not supported by the ticket.",
    "If the ticket lacks context, lower confidence rather than making strong claims.",
    "Return only the requested structured output.",
  ].join("\n");
}

export function buildUserPrompt(input: TicketInput, context: PromptContext): string {
  return [
    "Triage the following support request and return the structured result.",
    "",
    "Ticket input:",
    JSON.stringify(input, null, 2),
    "",
    "Help center context:",
    JSON.stringify(context.help_center_results, null, 2),
    "",
    "Recent account events:",
    JSON.stringify(context.recent_account_events, null, 2),
    "",
    "Guidance:",
    "- Keep escalation_reason empty when should_escalate is false.",
    "- recommended_action should be concrete and operational.",
    "- customer_reply should be concise and helpful.",
    "- Use the provided context when it is relevant, but do not invent facts that are not supported.",
  ].join("\n");
}

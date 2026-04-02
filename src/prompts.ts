import type {
  PolicyReviewerDecision,
  TicketInput,
  TriageEvidence,
  TriageSpecialistDraft,
} from "./schemas.js";
import type { HelpCenterResult, RecentAccountEvent } from "./tools.js";

export type PromptContext = {
  help_center_results: HelpCenterResult[];
  recent_account_events: RecentAccountEvent[];
};

function stringifyManagedPromptValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

export function buildLocalTriageSpecialistSystemPrompt(): string {
  return [
    "You are Helpr's triage specialist for a B2B SaaS company.",
    "Classify each ticket into one of: billing, auth, api, general.",
    "Set severity to one of: low, medium, high, critical.",
    "Decide whether escalation is needed based on business impact, urgency, and likely internal intervention.",
    "Be conservative. Do not invent facts that are not supported by the ticket.",
    "If the ticket lacks context, lower confidence rather than making strong claims.",
    "Return only the requested structured output for this stage.",
  ].join("\n");
}

export function buildLocalTriageSpecialistUserPrompt(
  input: TicketInput,
  context: PromptContext,
): string {
  return [
    "Produce a structured triage draft for the following support request.",
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
    "- evidence_summary should mention the strongest signals in the ticket or context.",
    "- Use the provided context when it is relevant, but do not invent facts that are not supported.",
  ].join("\n");
}

export function buildManagedTriageSpecialistVariables(
  input: TicketInput,
  context: PromptContext,
) {
  return {
    ticket: stringifyManagedPromptValue(input.ticket),
    customer_tier: stringifyManagedPromptValue(input.customer_tier ?? ""),
    account_id: stringifyManagedPromptValue(input.account_id ?? ""),
    product_area: stringifyManagedPromptValue(input.product_area ?? ""),
    help_center_results: stringifyManagedPromptValue(context.help_center_results),
    recent_account_events: stringifyManagedPromptValue(context.recent_account_events),
  };
}

export function buildManagedTriageSpecialistUserTemplate(): string {
  return [
    "Produce a structured triage draft for the following support request.",
    "",
    "Ticket:",
    "{{{ticket}}}",
    "",
    "Customer tier:",
    "{{{customer_tier}}}",
    "",
    "Account ID:",
    "{{{account_id}}}",
    "",
    "Product area:",
    "{{{product_area}}}",
    "",
    "Help center context:",
    "{{{help_center_results}}}",
    "",
    "Recent account events:",
    "{{{recent_account_events}}}",
    "",
    "Guidance:",
    "- Keep escalation_reason empty when should_escalate is false.",
    "- recommended_action should be concrete and operational.",
    "- evidence_summary should mention the strongest signals in the ticket or context.",
    "- Use the provided context when it is relevant, but do not invent facts that are not supported.",
  ].join("\n");
}

export function buildLocalPolicyReviewerSystemPrompt(): string {
  return [
    "You are Helpr's policy reviewer.",
    "Review the triage specialist draft for customer impact, urgency, and operational realism.",
    "You may approve or revise the draft.",
    "Keep critical rare and prefer high when one customer is blocked but there is no broad outage.",
    "Escalation means the issue likely needs internal intervention now, not just that it is important.",
    "Return only structured output for this stage.",
  ].join("\n");
}

export function buildLocalPolicyReviewerUserPrompt(
  input: TicketInput,
  context: TriageEvidence,
  draft: TriageSpecialistDraft,
): string {
  return [
    "Review the triage specialist draft and return the reviewed decision.",
    "",
    "Ticket input:",
    JSON.stringify(input, null, 2),
    "",
    "Collected evidence:",
    JSON.stringify(context, null, 2),
    "",
    "Specialist draft:",
    JSON.stringify(draft, null, 2),
    "",
    "Guidance:",
    "- Set reviewer_action to approved when the draft is good as-is.",
    "- Set reviewer_action to revised when you change any decision field.",
    "- Keep recommended_action concise and practical.",
    "- Keep review_notes short and specific.",
  ].join("\n");
}

export function buildManagedPolicyReviewerVariables(
  input: TicketInput,
  context: TriageEvidence,
  draft: TriageSpecialistDraft,
) {
  return {
    ticket: stringifyManagedPromptValue(input.ticket),
    customer_tier: stringifyManagedPromptValue(input.customer_tier ?? ""),
    account_id: stringifyManagedPromptValue(input.account_id ?? ""),
    product_area: stringifyManagedPromptValue(input.product_area ?? ""),
    help_center_results: stringifyManagedPromptValue(context.help_center_results),
    recent_account_events: stringifyManagedPromptValue(context.recent_account_events),
    specialist_draft: stringifyManagedPromptValue(draft),
  };
}

export function buildManagedPolicyReviewerUserTemplate(): string {
  return [
    "Review the triage specialist draft and return the reviewed decision.",
    "",
    "Ticket:",
    "{{{ticket}}}",
    "",
    "Customer tier:",
    "{{{customer_tier}}}",
    "",
    "Account ID:",
    "{{{account_id}}}",
    "",
    "Product area:",
    "{{{product_area}}}",
    "",
    "Help center context:",
    "{{{help_center_results}}}",
    "",
    "Recent account events:",
    "{{{recent_account_events}}}",
    "",
    "Specialist draft:",
    "{{{specialist_draft}}}",
    "",
    "Guidance:",
    "- Set reviewer_action to approved when the draft is good as-is.",
    "- Set reviewer_action to revised when you change any decision field.",
    "- Keep recommended_action concise and practical.",
    "- Keep review_notes short and specific.",
  ].join("\n");
}

export function buildLocalReplyWriterSystemPrompt(): string {
  return [
    "You are Helpr's reply writer.",
    "Write a concise customer-facing reply from the reviewed decision.",
    "Acknowledge the issue, explain the next step, and ask for only the minimum extra information needed.",
    "Do not reveal internal tooling or speculate beyond the reviewed decision.",
    "Return only structured output for this stage.",
  ].join("\n");
}

export function buildLocalReplyWriterUserPrompt(
  input: TicketInput,
  reviewedDecision: PolicyReviewerDecision,
): string {
  return [
    "Write the customer-facing reply for this reviewed decision.",
    "",
    "Ticket input:",
    JSON.stringify(input, null, 2),
    "",
    "Reviewed decision:",
    JSON.stringify(reviewedDecision, null, 2),
    "",
    "Guidance:",
    "- Keep the message concise.",
    "- Mention escalation only when should_escalate is true.",
    "- Ask for additional details only when they materially help the next step.",
  ].join("\n");
}

export function buildManagedReplyWriterVariables(
  input: TicketInput,
  reviewedDecision: PolicyReviewerDecision,
) {
  return {
    ticket: stringifyManagedPromptValue(input.ticket),
    customer_tier: stringifyManagedPromptValue(input.customer_tier ?? ""),
    account_id: stringifyManagedPromptValue(input.account_id ?? ""),
    product_area: stringifyManagedPromptValue(input.product_area ?? ""),
    reviewed_decision: stringifyManagedPromptValue(reviewedDecision),
  };
}

export function buildManagedReplyWriterUserTemplate(): string {
  return [
    "Write the customer-facing reply for this reviewed decision.",
    "",
    "Ticket:",
    "{{{ticket}}}",
    "",
    "Customer tier:",
    "{{{customer_tier}}}",
    "",
    "Account ID:",
    "{{{account_id}}}",
    "",
    "Product area:",
    "{{{product_area}}}",
    "",
    "Reviewed decision:",
    "{{{reviewed_decision}}}",
    "",
    "Guidance:",
    "- Keep the message concise.",
    "- Mention escalation only when should_escalate is true.",
    "- Ask for additional details only when they materially help the next step.",
  ].join("\n");
}

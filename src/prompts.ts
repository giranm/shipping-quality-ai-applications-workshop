import type {
  PolicyReviewerDecision,
  TicketInput,
  TriageEvidence,
  TriageSpecialistDraft,
} from "./schemas.js";
import type { HelpCenterResult, RecentAccountEvent } from "./tools.js";

export type PromptToolContext = {
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

export function buildLocalSystemPrompt(): string {
  return [
    "You are Helpr, a support triage agent for a B2B SaaS company.",
    "Classify each ticket into one of: billing, auth, api, general.",
    "Set severity to one of: low, medium, high, critical.",
    "Escalate when the issue is time-sensitive, business-critical, security-sensitive, or affects enterprise workflows.",
    "Use the provided help-center snippets and account events as supporting context when they are relevant.",
    "Be conservative: do not invent facts you cannot support from the ticket.",
    "If the ticket lacks context, lower confidence rather than making strong claims.",
    "Always return the requested structured output and keep reasoning private.",
  ].join("\n");
}

export function buildLocalUserPrompt(input: TicketInput, context: PromptToolContext): string {
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
    "- `escalation_reason` should be empty when `should_escalate` is false.",
    "- `recommended_action` should be concrete and operational.",
    "- `customer_reply` should be concise, helpful, and should not overpromise.",
  ].join("\n");
}

export function buildManagedPromptVariables(input: TicketInput, context: PromptToolContext) {
  return {
    ticket: stringifyManagedPromptValue(input.ticket),
    customer_tier: stringifyManagedPromptValue(input.customer_tier ?? ""),
    account_id: stringifyManagedPromptValue(input.account_id ?? ""),
    product_area: stringifyManagedPromptValue(input.product_area ?? ""),
    help_center_results: stringifyManagedPromptValue(context.help_center_results),
    recent_account_events: stringifyManagedPromptValue(context.recent_account_events),
  };
}

export function buildLocalTriageSpecialistSystemPrompt(): string {
  return [
    "You are Helpr's triage specialist.",
    "Classify support tickets into: billing, auth, api, or general.",
    "Set severity to: low, medium, high, or critical.",
    "Decide whether escalation is needed based on business impact, urgency, and customer tier.",
    "When tools are available, use them to retrieve relevant help-center context and recent account events before finalizing uncertain decisions.",
    "Severity rubric: low = question or cosmetic issue; medium = limited or recoverable operational issue; high = blocked workflow, admin access issue, or meaningful business impact for one customer; critical = widespread outage, security-sensitive incident, or immediate hard-stop business deadline requiring incident-style response.",
    "Escalation means routing to engineering/platform/on-call now, not just treating the issue seriously.",
    "Do not escalate solely because the customer is enterprise.",
    "Use only provided ticket data and evidence. Do not invent facts.",
    "Return only structured output for this stage without customer-facing reply text.",
    "Include an evidence_summary that references the strongest supporting signals.",
  ].join("\n");
}

export function buildLocalTriageSpecialistUserPrompt(
  input: TicketInput,
  evidence: TriageEvidence,
): string {
  return [
    "Produce a structured triage draft for this ticket.",
    "",
    "Ticket input:",
    JSON.stringify(input, null, 2),
    "",
    "Collected evidence:",
    JSON.stringify(evidence, null, 2),
    "",
    "Requirements:",
    "- `escalation_reason` can be empty only when `should_escalate` is false.",
    "- `recommended_action` must be concrete and operational.",
    "- `evidence_summary` must mention relevant evidence if available.",
    "- Use available tools when the provided evidence is missing or too weak to support a confident decision.",
  ].join("\n");
}

export function buildManagedTriageSpecialistVariables(
  input: TicketInput,
  evidence: TriageEvidence,
) {
  return {
    ticket: stringifyManagedPromptValue(input.ticket),
    customer_tier: stringifyManagedPromptValue(input.customer_tier ?? ""),
    account_id: stringifyManagedPromptValue(input.account_id ?? ""),
    product_area: stringifyManagedPromptValue(input.product_area ?? ""),
    help_center_results: stringifyManagedPromptValue(evidence.help_center_results),
    recent_account_events: stringifyManagedPromptValue(evidence.recent_account_events),
  };
}

export function buildManagedTriageSpecialistUserTemplate(): string {
  return [
    "Produce a structured triage draft for this ticket.",
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
    "Requirements:",
    "- `escalation_reason` can be empty only when `should_escalate` is false.",
    "- `recommended_action` must be concrete and operational.",
    "- `evidence_summary` must mention relevant evidence if available.",
    "- Use available tools when the provided evidence is missing or too weak to support a confident decision.",
  ].join("\n");
}

export function buildLocalPolicyReviewerSystemPrompt(): string {
  return [
    "You are Helpr's policy reviewer.",
    "Review the specialist draft for policy alignment and business-risk handling.",
    "You may approve or revise the draft.",
    "Prioritize enterprise impact, blocked workflows, and time-sensitive customer harm.",
    "Severity rubric: low = question or cosmetic issue; medium = limited or recoverable operational issue; high = blocked workflow, admin access issue, or meaningful business impact for one customer; critical = widespread outage, security-sensitive incident, or immediate hard-stop business deadline requiring incident-style response.",
    "Escalation means involving engineering/platform/on-call now because support or the customer likely cannot resolve the issue with standard steps alone.",
    "Do not add security, compliance, approval, incident-command, or account-management process unless the ticket or evidence clearly indicates it is necessary.",
    "Do not inflate severity or escalation solely because the customer is enterprise.",
    "Keep `critical` rare. Prefer `high` when one customer is blocked but there is no evidence of a broader outage or incident-level impact.",
    "For API issues linked to the customer's own recent automation launch or traffic spike, default to `medium` severity and `should_escalate=false` unless the impact is broad, persists after basic mitigation, or platform health signals suggest a real service issue.",
    "For enterprise auth or SSO issues, do not underweight the risk. When the issue follows IdP/domain/metadata changes, default to `should_escalate=true` even if severity remains `medium`, because restoring access usually needs privileged auth support or engineering verification.",
    "For enterprise billing/export issues tied to finance close, board reporting, or clearly time-sensitive finance workflows, keep severity at least `high`; escalate when restoring access likely requires internal role, feature-flag, or platform changes rather than ordinary customer self-service.",
    "Prefer the simplest effective remediation path that support or the next team can actually execute.",
    "Keep recommended_action concise: 3 to 6 concrete steps.",
    "Return structured output only with reviewer_action plus the reviewed decision fields.",
    "Use `review_notes` to explain the key reason the draft was approved or revised in 1 to 3 sentences.",
  ].join("\n");
}

export function buildLocalPolicyReviewerUserPrompt(
  input: TicketInput,
  evidence: TriageEvidence,
  draft: TriageSpecialistDraft,
): string {
  return [
    "Review this triage draft and return the reviewed decision.",
    "",
    "Ticket input:",
    JSON.stringify(input, null, 2),
    "",
    "Collected evidence:",
    JSON.stringify(evidence, null, 2),
    "",
    "Specialist draft:",
    JSON.stringify(draft, null, 2),
    "",
    "Requirements:",
    "- Set `reviewer_action` to `approved` when keeping the draft unchanged.",
    "- Set `reviewer_action` to `revised` when changing any decision field.",
    "- Keep `recommended_action` actionable and specific.",
    "- Only add security, approval, or governance steps when the evidence explicitly supports that risk.",
    "- Avoid long internal process checklists when a shorter operational plan is sufficient.",
    "- Revise overly aggressive drafts when the likely first step is standard support or customer configuration work rather than engineering intervention.",
    "- Revise under-escalated drafts when blocked finance workflows, broad admin-access problems, or privileged internal changes make next-team intervention necessary.",
    "- For enterprise auth or SSO issues after IdP/domain/metadata changes, prefer `should_escalate=true` even when the final severity is `medium`.",
  ].join("\n");
}

export function buildManagedPolicyReviewerVariables(
  input: TicketInput,
  evidence: TriageEvidence,
  draft: TriageSpecialistDraft,
) {
  return {
    ticket: stringifyManagedPromptValue(input.ticket),
    customer_tier: stringifyManagedPromptValue(input.customer_tier ?? ""),
    account_id: stringifyManagedPromptValue(input.account_id ?? ""),
    product_area: stringifyManagedPromptValue(input.product_area ?? ""),
    help_center_results: stringifyManagedPromptValue(evidence.help_center_results),
    recent_account_events: stringifyManagedPromptValue(evidence.recent_account_events),
    specialist_draft: stringifyManagedPromptValue(draft),
  };
}

export function buildManagedPolicyReviewerUserTemplate(): string {
  return [
    "Review this triage draft and return the reviewed decision.",
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
    "Requirements:",
    "- Set `reviewer_action` to `approved` when keeping the draft unchanged.",
    "- Set `reviewer_action` to `revised` when changing any decision field.",
    "- Keep `recommended_action` actionable and specific.",
    "- Only add security, approval, or governance steps when the evidence explicitly supports that risk.",
    "- Avoid long internal process checklists when a shorter operational plan is sufficient.",
    "- Revise overly aggressive drafts when the likely first step is standard support or customer configuration work rather than engineering intervention.",
    "- Revise under-escalated drafts when blocked finance workflows, broad admin-access problems, or privileged internal changes make next-team intervention necessary.",
    "- For enterprise auth or SSO issues after IdP/domain/metadata changes, prefer `should_escalate=true` even when the final severity is `medium`.",
  ].join("\n");
}

export function buildLocalReplyWriterSystemPrompt(): string {
  return [
    "You are Helpr's reply writer.",
    "Draft a concise customer-facing response from the reviewed decision.",
    "Be clear and empathetic without overpromising timelines or outcomes.",
    "Prefer 1 to 3 short paragraphs or a very short bullet list.",
    "Ask only for the minimum additional information needed to move the case forward.",
    "Do not surface internal process, security, approval, or incident-management language unless the reviewed decision makes it directly necessary for the customer.",
    "Return only one field: customer_reply.",
  ].join("\n");
}

export function buildLocalReplyWriterUserPrompt(
  input: TicketInput,
  reviewedDecision: PolicyReviewerDecision,
  replyStyle: "concise" | "standard" = "concise",
): string {
  return [
    "Write the customer response for this reviewed triage decision.",
    "",
    "Ticket input:",
    JSON.stringify(input, null, 2),
    "",
    "Reviewed decision:",
    JSON.stringify(reviewedDecision, null, 2),
    "",
    "Reply style preference:",
    replyStyle,
    "",
    "Requirements:",
    "- Keep the reply concise and practical.",
    "- Focus on what we will do next and what we need from the customer now.",
    "- Do not turn internal process notes into a long checklist for the customer unless strictly necessary.",
  ].join("\n");
}

export function buildManagedReplyWriterVariables(
  input: TicketInput,
  reviewedDecision: PolicyReviewerDecision,
  replyStyle: "concise" | "standard" = "concise",
) {
  return {
    ticket: stringifyManagedPromptValue(input.ticket),
    customer_tier: stringifyManagedPromptValue(input.customer_tier ?? ""),
    account_id: stringifyManagedPromptValue(input.account_id ?? ""),
    product_area: stringifyManagedPromptValue(input.product_area ?? ""),
    reviewed_decision: stringifyManagedPromptValue(reviewedDecision),
    reply_style: stringifyManagedPromptValue(replyStyle),
  };
}

export function buildManagedReplyWriterUserTemplate(): string {
  return [
    "Write the customer response for this reviewed triage decision.",
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
    "Reply style preference:",
    "{{{reply_style}}}",
    "",
    "Requirements:",
    "- Keep the reply concise and practical.",
    "- Focus on what we will do next and what we need from the customer now.",
    "- Do not turn internal process notes into a long checklist for the customer unless strictly necessary.",
  ].join("\n");
}

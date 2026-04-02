import {
  accountEventsByAccountId,
  escalationTemplate,
  helpCenterArticles,
  type AccountEvent,
  type EscalationRecord,
  type HelpCenterArticle,
} from "./sample-data.js";

export type HelpCenterResult = HelpCenterArticle;
export type RecentAccountEvent = AccountEvent;
export type EscalationToolResult = EscalationRecord;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function scoreArticle(query: string, article: HelpCenterArticle): number {
  const normalizedQuery = normalize(query);
  let score = 0;

  for (const token of [article.title, ...article.tags, article.snippet]) {
    const normalizedToken = normalize(token);
    if (normalizedQuery.includes(normalizedToken.trim())) {
      score += 3;
    }
  }

  for (const term of normalizedQuery.split(/\s+/).filter(Boolean)) {
    if (article.tags.some((tag) => normalize(tag).includes(term))) {
      score += 2;
    }
    if (normalize(article.title).includes(term)) {
      score += 2;
    }
    if (normalize(article.snippet).includes(term)) {
      score += 1;
    }
  }

  return score;
}

export function searchHelpCenter(query: string): HelpCenterResult[] {
  const scored = helpCenterArticles
    .map((article) => ({ article, score: scoreArticle(query, article) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.article.id.localeCompare(right.article.id));

  return scored.slice(0, 3).map(({ article }) => article);
}

export function lookupRecentAccountEvents(accountId?: string): RecentAccountEvent[] {
  if (!accountId) {
    return [];
  }

  return [...(accountEventsByAccountId[accountId] ?? [])].sort((left, right) =>
    left.occurred_at.localeCompare(right.occurred_at),
  );
}

function hashReason(reason: string): string {
  let hash = 0;

  for (const char of reason) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36).padStart(6, "0").slice(0, 6);
}

export function createEscalation(reason: string): EscalationToolResult {
  return {
    ...escalationTemplate,
    id: `esc_${hashReason(reason)}`,
    reason: reason.trim(),
  };
}

export type HelpCenterArticle = {
  id: string;
  title: string;
  tags: string[];
  snippet: string;
};

export type AccountEvent = {
  id: string;
  type: string;
  summary: string;
  occurred_at: string;
};

export type EscalationRecord = {
  id: string;
  queue: string;
  eta_minutes: number;
  reason: string;
};

export const helpCenterArticles: HelpCenterArticle[] = [
  {
    id: "hc_001",
    title: "Invoice export permissions for billing admins",
    tags: ["billing", "invoice", "export", "permissions"],
    snippet: "Invoice export requires the billing admin role and a valid enterprise billing permission set.",
  },
  {
    id: "hc_002",
    title: "Plan migration can reset export access",
    tags: ["billing", "migration", "export", "enterprise"],
    snippet: "After a plan migration, export access can be reset until billing permissions are re-applied.",
  },
  {
    id: "hc_003",
    title: "SSO issues after domain migration",
    tags: ["auth", "sso", "domain", "migration"],
    snippet: "If SSO fails after domain migration, verify the new domain is registered and the IdP callback URL is current.",
  },
  {
    id: "hc_004",
    title: "API rate limits for enterprise plans",
    tags: ["api", "rate limits", "enterprise"],
    snippet: "Enterprise API limits are higher, but spikes can still trigger short-lived throttling.",
  },
];

export const accountEventsByAccountId: Record<string, AccountEvent[]> = {
  acct_104: [
    {
      id: "evt_104_1",
      type: "plan_changed",
      summary: "Pro upgraded to Enterprise",
      occurred_at: "2026-03-17T09:15:00Z",
    },
    {
      id: "evt_104_2",
      type: "billing_admin_role_removed",
      summary: "Billing admin role was removed from the only finance user",
      occurred_at: "2026-03-17T09:17:00Z",
    },
    {
      id: "evt_104_3",
      type: "invoice_export_feature_flag",
      summary: "Invoice export feature flag set to false",
      occurred_at: "2026-03-17T09:18:00Z",
    },
  ],
  acct_201: [
    {
      id: "evt_201_1",
      type: "domain_migration",
      summary: "Company domain changed during migration",
      occurred_at: "2026-03-16T14:30:00Z",
    },
    {
      id: "evt_201_2",
      type: "sso_metadata_updated",
      summary: "SSO metadata still points at the old IdP callback URL",
      occurred_at: "2026-03-16T14:42:00Z",
    },
  ],
  acct_309: [
    {
      id: "evt_309_1",
      type: "api_usage_spike",
      summary: "Burst of API calls from a new automation job",
      occurred_at: "2026-03-18T07:05:00Z",
    },
  ],
};

export const escalationTemplate: EscalationRecord = {
  id: "esc_000",
  queue: "support-escalations",
  eta_minutes: 30,
  reason: "",
};

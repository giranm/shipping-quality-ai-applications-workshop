import {
  ticketInputSchema,
  triageEvidenceSchema,
  type TicketInput,
  type TriageEvidence,
} from "../schemas.js";
import { lookupRecentAccountEvents, searchHelpCenter } from "../tools.js";

type MaybePromise<T> = T | Promise<T>;

export type CollectContextDependencies = {
  searchHelpCenter?: (query: string) => MaybePromise<TriageEvidence["help_center_results"]>;
  lookupRecentAccountEvents?: (
    accountId?: string,
  ) => MaybePromise<TriageEvidence["recent_account_events"]>;
};

export type CollectContextArgs = {
  input: TicketInput;
  dependencies?: CollectContextDependencies;
};

export async function collectContext(args: CollectContextArgs): Promise<TriageEvidence> {
  const input = ticketInputSchema.parse(args.input);
  const deps = args.dependencies;
  const search = deps?.searchHelpCenter ?? searchHelpCenter;
  const lookup = deps?.lookupRecentAccountEvents ?? lookupRecentAccountEvents;
  const query = [input.product_area, input.ticket].filter(Boolean).join(" ");
  const [helpCenterResults, recentAccountEvents] = await Promise.all([
    Promise.resolve(search(query)),
    Promise.resolve(lookup(input.account_id)),
  ]);

  return triageEvidenceSchema.parse({
    help_center_results: helpCenterResults,
    recent_account_events: recentAccountEvents,
  });
}

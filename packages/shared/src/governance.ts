import { z } from 'zod';

/**
 * The governance change-event payload (M7's `appendGovernance` write path). The
 * prose-bearing bodies (decision text, vouch note, flag-feedback reason) stay
 * WAL-local and never reach the sync-eligible ledger (DT-5). M0 fixes the
 * discriminant; the typed bodies are M7's.
 */
export const governancePayloadSchema = z.object({
  sub: z.enum(['decision', 'vouch', 'cap-record', 'subtractive-change']),
});
export type GovernancePayload = z.infer<typeof governancePayloadSchema>;

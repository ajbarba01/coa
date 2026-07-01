import { z } from 'zod';

/** Edge schema for the daemon's `capState` result (parse untrusted JSON-RPC output). */
export const CapStateSchema = z.object({
  remaining: z.number().nullable(),
  capHit: z.boolean(),
});
export type CapState = z.infer<typeof CapStateSchema>;

export interface CapViewModel {
  headline: string;
  sub: string;
  tone: 'neutral' | 'danger';
}

export function toCapViewModel(raw: unknown): CapViewModel {
  const s = CapStateSchema.parse(raw);
  if (s.capHit) return { headline: 'Cap reached', sub: 'spending paused', tone: 'danger' };
  if (s.remaining === null) return { headline: 'No ceiling', sub: 'subscription', tone: 'neutral' };
  return { headline: `$${s.remaining.toFixed(2)} left`, sub: 'under cap', tone: 'neutral' };
}

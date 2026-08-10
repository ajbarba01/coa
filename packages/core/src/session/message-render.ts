import type { Delivery } from '@coa/spi';
import { flattenControlChars } from './notify.js';

/**
 * Realize a dispatched inter-agent message as something the RECEIVING model actually
 * reads (docs/adr/0039). A message body is free text with no upstream format guarantee
 * — model-authored, untrusted content, sanitized the same way `notify.ts`'s
 * `detail`/`result` already are — flattened and capped before it rides into either
 * realization below, never trusted as bare unescaped text.
 */

/** How much of a message body to keep. Wider than a completion notice's excerpt cap
 *  (`notify.ts`'s 2000-char `MAX_RESULT_LENGTH`) because here the body IS the whole
 *  point of the call, not an incidental quoted excerpt — but still bounded, so one
 *  agent cannot flood another's context in a single send. */
const MAX_MESSAGE_BODY_LENGTH = 4000;

function sanitizeBody(raw: string): string {
  const flattened = flattenControlChars(raw);
  if (flattened.length === 0) return '(empty message)';
  return flattened.length > MAX_MESSAGE_BODY_LENGTH
    ? `${flattened.slice(0, MAX_MESSAGE_BODY_LENGTH)}…`
    : flattened;
}

/** The one envelope sentence both realizations below share: WHO the message is from
 *  (agent ref + session id, mirroring `notify.ts`'s `renderChildEnded` head format) and
 *  the sanitized body. The daemon composes this sentence; the body enters only as
 *  interpolated, bounded, quoted data — the same trust shape ADR-0038 established for a
 *  completion notice's own quoted excerpt. */
function renderEnvelope(fromAgentRef: string, from: string, body: string): string {
  return `message from agent ${fromAgentRef} (${from}): ${sanitizeBody(body)}`;
}

/**
 * The MID-TURN realization: the recipient is actively running, so the message rides
 * the existing `Delivery`/`DeliveryQueue` mechanism (docs/adr/0030) and lands at that
 * turn's own next boundary. `origin: 'system'` is correct here (not a lie): the
 * ENVELOPE — "a message arrived, from whom" — is a fact this process itself observed,
 * exactly like a completion notice's envelope; only the quoted body is agent-authored,
 * untrusted content, riding inertly inside it. The persisted frame is tagged
 * `role: 'system'` (`frame-recorder.ts`'s existing mapping), so it is distinguishable
 * from the human's own words in the durable log, just as a completion notice already is.
 */
export function renderMidTurnDelivery(args: {
  fromAgentRef: string;
  from: string;
  body: string;
}): Delivery {
  return { origin: 'system', text: renderEnvelope(args.fromAgentRef, args.from, args.body) };
}

/**
 * The WAKE realization: the recipient has no turn in flight to inject into (idle,
 * not currently registered, or not yet started), so the message becomes a fresh
 * turn's `input` — the only way to actually start the recipient's drive loop
 * (`session-service.ts`'s `#wake`). Unlike a mid-turn delivery, `TurnRequest.input` has
 * no role slot at all: whatever a turn starts with is always persisted as `role: 'user'`
 * (`prepareTurnPersistence`'s unconditional `cs.append(...{role:'user'})`). Rather than
 * widen that schema (a change that would ripple through every adapter and the console —
 * see docs/adr/0039's "deviation" section for why that was rejected as disproportionate
 * to this arc), this leans on the SAME bracketed-provenance idiom the codebase already
 * uses for exactly this gap (`renderDelivery`'s `[The user sent this while you were
 * working]`, `deniedNotice`'s `[Stopped by coa: ...]`, `INTERRUPTED_BY_USER`): an
 * explicit, daemon-composed prefix makes the provenance unambiguous to both a human
 * reading the transcript and the model itself, even though the persisted `role` field
 * cannot (yet) carry it. A future schema widening to a dedicated role is a named,
 * deliberately deferred follow-up (docs/adr/0039), not attempted here.
 */
export function renderWakeInput(args: {
  fromAgentRef: string;
  from: string;
  body: string;
}): string {
  return `[coa: inter-agent message] ${renderEnvelope(args.fromAgentRef, args.from, args.body)}`;
}

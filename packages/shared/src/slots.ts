import { z } from 'zod';

/** The DC-6 section skeleton: the ordered slots the assembled prompt renders as. Headers are data (tunable
 *  here). The assembly emits each non-empty slot's header + its Piece bodies, in this order. */
export const SLOTS = [
  { id: 'identity', header: '## Identity' },
  { id: 'model', header: '## Model' },
  { id: 'tone', header: '## Tone' },
  { id: 'tool-use', header: '## Using tools' },
  { id: 'code-discipline', header: '## Changing code' },
  { id: 'governance', header: '## Operating under coa' },
  { id: 'roles', header: '## Role' },
  { id: 'project', header: '## Project context' },
  { id: 'volatile', header: '## Environment' },
] as const;

export type SlotId = (typeof SLOTS)[number]['id'];
const SLOT_IDS = SLOTS.map((s) => s.id) as [SlotId, ...SlotId[]];
export const slotIdSchema = z.enum(SLOT_IDS);

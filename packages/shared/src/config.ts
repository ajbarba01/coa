import { z } from 'zod';
import { capabilityFrameSchema } from './capability.js';
import { contextPackageRefSchema } from './context.js';
import { orderedPieceSchema, pieceSchema } from './piece.js';
import { reminderSchema } from './reminder.js';

/**
 * The backend-NEUTRAL compiled config (M5's output; authoritative here per
 * D-CAT, M5 cross-references). The slot set is unchanged by the TAX-* collapse —
 * the axes are a front-end over these same slots (D105 intact).
 */
export const neutralConfigSchema = z.object({
  prefixHead: z.array(orderedPieceSchema),
  systemReminders: z.array(reminderSchema),
  onDemandPullable: z.array(z.string()),
  scopePushed: z.array(pieceSchema),
  toolIntents: capabilityFrameSchema,
  assembledContextSlot: contextPackageRefSchema.optional(),
});
export type NeutralConfig = z.infer<typeof neutralConfigSchema>;

/**
 * coa's faithful mirror of a provider's real reasoning surface — a thin coa-owned
 * layer over the backend API, NOT a lossy abstraction and NOT a raw SDK type. For
 * Claude it is 1:1 with the SDK `thinking`/`effort` options: `off` = no extended
 * thinking; `effort` = adaptive thinking at one of the API's real effort levels
 * (`xhigh`/`max` are model-gated — surfaced faithfully, the API rejects an
 * unsupported pairing); `budget` = a fixed thinking-token budget. The adapter maps
 * this 1:1 to the SDK; the console renders exactly these options.
 */
export const claudeEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type ClaudeEffort = z.infer<typeof claudeEffortSchema>;

export const claudeReasoningSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('off') }),
  z.object({ mode: z.literal('effort'), effort: claudeEffortSchema }),
  z.object({ mode: z.literal('budget'), budgetTokens: z.number().int().positive() }),
]);
export type ClaudeReasoning = z.infer<typeof claudeReasoningSchema>;

/**
 * The model selection an agent/session carries. `provider` routes to a backend
 * adapter (absent ⇒ the default backend); `model` is that provider's model id
 * (absent ⇒ the account default); `reasoning` is the provider's faithful reasoning
 * config. NOTE: `reasoning` is typed as {@link ClaudeReasoning} while coa is
 * Claude-locked; it generalizes to a provider-discriminated union when a second
 * adapter (DeepSeek) lands.
 */
export const modelSelectionSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  reasoning: claudeReasoningSchema.optional(),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

/**
 * A model as a backend reports it — coa's neutral mirror of the provider's model
 * capabilities, so the console offers each model's REAL reasoning options rather
 * than a flat guess. `supportedEffortLevels` is model-specific (Haiku ≠ Opus);
 * absent/`supportsEffort:false` ⇒ the model exposes no effort control. Populated
 * from the backend (Claude: the SDK's `supportedModels()`), cached per account.
 */
export const modelDescriptorSchema = z.object({
  id: z.string(),
  /** The backend this model runs on — set when providers are merged into one list. */
  provider: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  supportsEffort: z.boolean().optional(),
  supportedEffortLevels: z.array(claudeEffortSchema).optional(),
  supportsAdaptiveThinking: z.boolean().optional(),
});
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

export const sessionConfigSchema = z.object({
  role: z.string(),
  scope: z.string(),
  worktree: z.string(),
  capabilityFrame: capabilityFrameSchema,
});
export type SessionConfig = z.infer<typeof sessionConfigSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  config: sessionConfigSchema,
  worktree: z.string(),
  /** The account label this session ran under (incl. `'ambient'`); absent ⇒ account selection not wired. */
  account: z.string().optional(),
});
export type Session = z.infer<typeof sessionSchema>;

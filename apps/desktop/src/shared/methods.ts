import {
  AccountsSchema,
  ActiveAccountSchema,
  CapStateSchema,
  FeedViewSchema,
  TimelineSchema,
  modelSelectionSchema,
  modelDescriptorSchema,
} from '@coa/console-viewmodel';
import { z } from 'zod';
import { ConsoleSettingsSchema } from './settings.js';

/** Params/result for starting a governed session from the console (proxies the daemon `createSession`). */
export const StartSessionParamsSchema = z.object({
  input: z.string(),
  role: z.string().optional(),
  scope: z.string().optional(),
  model: modelSelectionSchema.optional(),
});
export const StartSessionResultSchema = z.object({ sessionId: z.string(), worktree: z.string() });

/** The one-way main→renderer event channel carrying the daemon's CON-PUSH stream. */
export const PUSH_CHANNEL = 'coa:push';

/**
 * The single source of truth for the IPC bridge: each verb -> its params/result
 * Zod schemas, consumed by BOTH the preload/main validation and the renderer.
 * `capState` proxies the daemon read verb; `getLayout`/`saveLayout` are main-local
 * file ops. The layout descriptor is console-local and re-validated at the renderer
 * edge (parseDescriptor), so main persists it opaquely (z.unknown).
 */
export interface MethodSpec {
  params?: z.ZodType | undefined;
  result: z.ZodType;
}

export type MethodName =
  | 'capState'
  | 'flagsForUser'
  | 'listTimeline'
  | 'listAccounts'
  | 'currentAccount'
  | 'useAccount'
  | 'startSession'
  | 'listModels'
  | 'getLayout'
  | 'saveLayout'
  | 'getSettings'
  | 'saveSettings';

export const METHODS: Record<MethodName, MethodSpec> = {
  capState: { result: CapStateSchema },
  flagsForUser: { result: FeedViewSchema },
  listTimeline: { result: TimelineSchema },
  listAccounts: { result: AccountsSchema },
  currentAccount: { result: ActiveAccountSchema },
  useAccount: { params: z.object({ label: z.string() }), result: ActiveAccountSchema },
  startSession: { params: StartSessionParamsSchema, result: StartSessionResultSchema },
  listModels: { result: z.array(modelDescriptorSchema) },
  getLayout: { result: z.unknown() },
  saveLayout: { params: z.unknown(), result: z.void() },
  getSettings: { result: ConsoleSettingsSchema },
  saveSettings: { params: ConsoleSettingsSchema, result: z.void() },
};

/** The ipcRenderer/ipcMain channel name for a verb. */
export function channel(m: MethodName): string {
  return `coa:${m}`;
}

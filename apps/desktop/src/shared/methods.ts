import {
  AccountsSchema,
  ActiveAccountSchema,
  CapStateSchema,
  FeedViewSchema,
  PackageSummaryListSchema,
  RoleSummaryListSchema,
  SessionListSchema,
  TimelineSchema,
  modelSelectionSchema,
  modelDescriptorSchema,
  persistedTurnsSchema,
} from '@coa/console-viewmodel';
import { z } from 'zod';
import { ConsoleSettingsSchema } from './settings.js';

/** Params/result for starting a governed session from the console (proxies the daemon `createSession`). */
export const StartSessionParamsSchema = z.object({
  input: z.string(),
  /** The persistent conversation this send belongs to (R-7); absent ⇒ an ephemeral one-shot. */
  conversationId: z.string().optional(),
  role: z.string().optional(),
  scope: z.string().optional(),
  model: modelSelectionSchema.optional(),
  /** Assembly selection: opt-in packages added / default packages excluded (role-gated). */
  packageIds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});
export const StartSessionResultSchema = z.object({ sessionId: z.string(), worktree: z.string() });

/** Params for creating a persistent session record (R-7) — proxies the daemon `newSession`. */
export const NewSessionParamsSchema = z.object({
  agentRef: z.string(),
  scope: z.string().optional(),
});
export const NewSessionResultSchema = z.object({ id: z.string() });
const OkResultSchema = z.object({ ok: z.boolean() });

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
  | 'newSession'
  | 'listSessions'
  | 'reloadConversation'
  | 'renameSession'
  | 'deleteSession'
  | 'listModels'
  | 'listRoles'
  | 'listPackages'
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
  newSession: { params: NewSessionParamsSchema, result: NewSessionResultSchema },
  listSessions: { result: SessionListSchema },
  reloadConversation: { params: z.object({ id: z.string() }), result: persistedTurnsSchema },
  renameSession: {
    params: z.object({ id: z.string(), title: z.string() }),
    result: OkResultSchema,
  },
  deleteSession: { params: z.object({ id: z.string() }), result: OkResultSchema },
  listModels: { result: z.array(modelDescriptorSchema) },
  listRoles: { result: RoleSummaryListSchema },
  listPackages: { result: PackageSummaryListSchema },
  getLayout: { result: z.unknown() },
  saveLayout: { params: z.unknown(), result: z.void() },
  getSettings: { result: ConsoleSettingsSchema },
  saveSettings: { params: ConsoleSettingsSchema, result: z.void() },
};

/** The ipcRenderer/ipcMain channel name for a verb. */
export function channel(m: MethodName): string {
  return `coa:${m}`;
}

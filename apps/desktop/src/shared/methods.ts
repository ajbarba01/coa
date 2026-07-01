import { CapStateSchema, FeedViewSchema, TimelineSchema } from '@coa/console-viewmodel';
import { z } from 'zod';

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

export type MethodName = 'capState' | 'flagsForUser' | 'listTimeline' | 'getLayout' | 'saveLayout';

export const METHODS: Record<MethodName, MethodSpec> = {
  capState: { result: CapStateSchema },
  flagsForUser: { result: FeedViewSchema },
  listTimeline: { result: TimelineSchema },
  getLayout: { result: z.unknown() },
  saveLayout: { params: z.unknown(), result: z.void() },
};

/** The ipcRenderer/ipcMain channel name for a verb. */
export function channel(m: MethodName): string {
  return `coa:${m}`;
}

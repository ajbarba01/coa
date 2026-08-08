import { create } from 'zustand';
import type { Status } from '@coa/console-kit';

/**
 * The console's one failure surface.
 *
 * Nearly every user-initiated write in the renderer is fire-and-forget: the panel renders
 * the edit and lets the round trip settle in the background. That is the right shape for
 * a responsive surface, but it used to end in `.catch(() => {})` — so a write that was
 * REJECTED looked exactly like one that landed. Pasting an API key that failed to save
 * gave no indication whatsoever. Everything that a user asked for and did not get is
 * announced here instead.
 *
 * Advisory, never a gate: a failure is stated and the app carries on. The surface takes no
 * focus, blocks nothing, and asks for no decision.
 *
 * One notice at a time, deliberately. It is a CONTROLLED toast (the kit's `Toast` — see
 * its own note on why it owns no queue), and a queue would mostly stack duplicates from a
 * burst of writes that all failed for the same reason. The newest wins: the most recent
 * thing the user did is the thing they want an answer about.
 */
export interface Notice {
  /** Bumped per announcement, so repeating the same message still re-announces it. */
  key: number;
  title: string;
  detail?: string | undefined;
  tone: Status;
}

interface NoticeState {
  notice?: Notice | undefined;
  announce: (notice: Omit<Notice, 'key'>) => void;
  dismiss: () => void;
}

export const useNotices = create<NoticeState>((set, get) => ({
  notice: undefined,
  announce: (notice) => set({ notice: { ...notice, key: (get().notice?.key ?? 0) + 1 } }),
  dismiss: () => set({ notice: undefined }),
}));

/** Announce that a write the user asked for failed. `action` completes "Couldn't …", so it
 *  names what they wanted rather than the verb that failed: `save that login` reads as
 *  "Couldn't save that login". */
export function reportFailure(action: string, error: unknown): void {
  useNotices.getState().announce({
    title: `Couldn't ${action}`,
    detail: error instanceof Error ? error.message : String(error),
    tone: 'danger',
  });
}

/** Announce something the user should know that is not itself a failure — the daemon
 *  answering that there was nothing to do. Same surface, quieter tone. */
export function reportNotice(title: string, detail?: string): void {
  useNotices.getState().announce({ title, detail, tone: 'info' });
}

/**
 * Route a fire-and-forget user-initiated write through the failure surface. The call site
 * keeps its "kick it off and move on" shape; the rejection that used to vanish is
 * announced. Resolves `undefined` on failure and never rejects, so a `void` at the call
 * site is still honest.
 *
 * Read paths do NOT belong here — they map failure into their own loading/error state and
 * a poll that toasts every tick would be noise.
 */
export function surfaceWrite<T>(action: string, work: Promise<T>): Promise<T | undefined> {
  return work.catch((error: unknown) => {
    reportFailure(action, error);
    return undefined;
  });
}

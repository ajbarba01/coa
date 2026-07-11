import { z } from 'zod';
import { useShell } from './store.js';

/** Bump when the persisted shape changes so a stale layout.json (a pre-Workbench
 *  shell shape) is ignored rather than hydrating a mismatched store. */
export const SHELL_LAYOUT_EPOCH = 5;

const ShellLayoutSchema = z.object({
  epoch: z.literal(SHELL_LAYOUT_EPOCH),
  surface: z.string(),
  tabs: z.array(z.string()),
  workOpen: z.boolean(),
  navWidth: z.number(),
  workWidth: z.number(),
});

export type ShellLayout = z.infer<typeof ShellLayoutSchema>;

const DEFAULT_LAYOUT: ShellLayout = {
  epoch: SHELL_LAYOUT_EPOCH,
  surface: 'chat',
  tabs: [],
  workOpen: true,
  navWidth: 196,
  workWidth: 218,
};

/** Validate a persisted layout (untrusted JSON from disk): wrong epoch, a missing
 *  field, or corrupt input all degrade to the default arrangement — this never
 *  throws, so a stale/corrupt layout.json can't block startup. */
export function parseShellLayout(raw: unknown): ShellLayout {
  const parsed = ShellLayoutSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_LAYOUT;
}

/** Stamp the current epoch onto the persisted subset for storage (defensive even
 *  if the caller's value carries a stale one). */
export function serializeShellLayout(s: ShellLayout): unknown {
  return { ...s, epoch: SHELL_LAYOUT_EPOCH };
}

/** Trailing debounce so a drag-resize burst (many width changes per second)
 *  writes to disk once, not per pixel. */
const SAVE_DEBOUNCE_MS = 300;

/** The subset of the console bridge layout persistence needs (injected for testing). */
export interface LayoutBridge {
  getLayout(): Promise<unknown>;
  saveLayout(descriptor: unknown): Promise<void>;
}

/** Hydrate `useShell` from the persisted layout, then subscribe and save the
 *  persisted subset on every change, debounced 300ms trailing. Returns an
 *  unsubscribe that also cancels any pending debounced save. */
export async function bindLayoutPersistence(bridge: LayoutBridge): Promise<() => void> {
  const layout = parseShellLayout(await bridge.getLayout());
  useShell.setState({
    surface: layout.surface,
    tabs: layout.tabs,
    workOpen: layout.workOpen,
    navWidth: layout.navWidth,
    workWidth: layout.workWidth,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = useShell.subscribe((s, prev) => {
    // Only the persisted subset should trigger a write — e.g. opening a dialog
    // (settingsOpen) touches the store but has nothing to do with layout.json.
    const persistedChanged =
      s.surface !== prev.surface ||
      s.tabs !== prev.tabs ||
      s.workOpen !== prev.workOpen ||
      s.navWidth !== prev.navWidth ||
      s.workWidth !== prev.workWidth;
    if (!persistedChanged) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void bridge.saveLayout(
        serializeShellLayout({
          epoch: SHELL_LAYOUT_EPOCH,
          surface: s.surface,
          tabs: s.tabs,
          workOpen: s.workOpen,
          navWidth: s.navWidth,
          workWidth: s.workWidth,
        }),
      );
    }, SAVE_DEBOUNCE_MS);
  });

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe();
  };
}

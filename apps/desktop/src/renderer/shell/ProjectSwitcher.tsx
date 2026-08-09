import { Button, CapsLabel, ModalShell, cx } from '@coa/console-kit';
import { useEffect, useState } from 'react';
import type { RecentProject } from '../../shared/projects.js';
import { surfaceWrite } from './failures.js';
import { DRAG, NO_DRAG } from './appRegion.js';
import { useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';

type RecentProjectView = RecentProject & { open: boolean };

/**
 * Case-fold on Windows (whose filesystem is case-insensitive) for root IDENTITY
 * comparisons — the renderer-side echo of `canonicalProjectRoot`'s rule. Main
 * can't be reached synchronously from here, and `node:path` is unavailable in the
 * sandboxed renderer, so this can't literally share that function; `platform` is
 * injected (`window.coa.platform` at the real call site) so it stays pure and
 * testable, matching every OTHER injected-canonicalize seam in this codebase
 * (`window-registry.ts`, `recent-projects.ts`). Without this, a picker dialog
 * handing back a different drive-letter case than the window's stored root reads
 * as a DIFFERENT project even though it's the same one.
 */
function sameRoot(a: string, b: string, platform: string): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Pure: whether swapping THIS window to `targetRoot` needs a confirm first (F11 rule #3
 * — silent if idle, confirm if a turn is running). Re-picking the window's OWN current
 * project is never a swap at all — main's contract treats a matching root as a plain
 * re-focus — so it never asks regardless of what's running.
 */
export function shouldConfirmSwap(
  runningCount: number,
  targetRoot: string,
  currentRoot: string | undefined,
  platform: string,
): boolean {
  const same = currentRoot !== undefined && sameRoot(targetRoot, currentRoot, platform);
  return runningCount > 0 && !same;
}

/** The directory's display name — the last non-empty path segment, either separator. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts.at(-1) ?? path;
}

/**
 * Call `openProject` and land its result: a `'current'` swap that actually changed root
 * adopts the new workspace (which tears down and reboots the console controller — see
 * `applyProjectSwitch`); every other outcome (a fresh window, a focus of some other
 * window, or a no-op re-pick of THIS window's own project) just closes the picker. Never
 * gates on running turns itself — the caller (`requestOpen`) does that before this runs.
 */
async function performOpenProject(root: string, target: 'current' | 'new'): Promise<void> {
  const priorRoot = useShell.getState().workspace?.root;
  const res = await surfaceWrite('open that project', window.coa.openProject({ root, target }));
  if (res === undefined) return;
  const changed =
    priorRoot === undefined || !sameRoot(res.workspace.root, priorRoot, window.coa.platform);
  if (res.opened === 'current' && changed) {
    useShell.getState().applyProjectSwitch(res.workspace);
  } else {
    useShell.getState().setProjectOpen(false);
  }
}

/** Open `root` with `target`, gating a `'current'` swap on `shouldConfirmSwap` first — a
 *  `'new'` window never touches this window's own turn, so it always proceeds directly. */
function requestOpen(root: string, target: 'current' | 'new'): void {
  if (target === 'current') {
    const running = Object.keys(useConsoleState.getState()?.ui.runStatus ?? {}).length;
    const currentRoot = useShell.getState().workspace?.root;
    if (shouldConfirmSwap(running, root, currentRoot, window.coa.platform)) {
      useShell.getState().setConfirmSwapProject({ root, name: baseName(root) });
      return;
    }
  }
  void performOpenProject(root, target);
}

async function pickAndOpen(target: 'current' | 'new'): Promise<void> {
  const defaultPath = useShell.getState().workspace?.root;
  const res = await window.coa.pickDirectory(defaultPath !== undefined ? { defaultPath } : {});
  if (res.path === undefined) return;
  requestOpen(res.path, target);
}

/** The project switch — the title-bar segment opens a picker: the current project, an
 *  arbitrary folder (native dialog) opened here or in a new window, and the recent-
 *  projects MRU main persists. */
export function ProjectButton(): React.JSX.Element {
  const open = useShell((s) => s.projectOpen);
  const setOpen = useShell((s) => s.setProjectOpen);
  const workspace = useShell((s) => s.workspace);
  const name = workspace?.name ?? '…';

  const [recent, setRecent] = useState<RecentProjectView[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.coa
      .listRecentProjects()
      .then((rows) => {
        if (!cancelled) setRecent(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <>
      {/* the segment is drag surface; the button's hitbox is its content, not
          the whole sidebar width */}
      <div
        className="flex h-(--titlebar-h) w-full flex-none items-center justify-center border-b border-s4"
        style={DRAG}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="slip group flex h-full min-w-0 cursor-pointer items-center gap-2 px-3.5"
          style={NO_DRAG}
        >
          <span className="slip font-mono text-icon text-s8 group-hover:text-s10">▣</span>
          <span className="slip truncate text-sec font-semibold text-s11 group-hover:text-s12">
            {name}
          </span>
          <span className="slip font-mono text-icon text-s7 group-hover:text-s9">⇄</span>
        </button>
      </div>

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        aria-label="Switch Project"
        className="flex w-105 flex-col"
      >
        <CapsLabel className="border-b border-s3 px-4 py-2.5">Projects</CapsLabel>
        <div className="flex w-full flex-col gap-0.5 bg-s3 px-4 py-2.5 text-left">
          <span className="flex items-center gap-2 text-body font-[550] text-s11">
            {name}
            <span className="ml-auto font-mono text-caps text-s7">Open</span>
          </span>
          {workspace?.root !== undefined && (
            <span className="truncate font-mono text-meta text-s7">{workspace.root}</span>
          )}
        </div>

        <div className="flex gap-2 border-t border-s3 px-4 py-2.5">
          <Button variant="outline" className="flex-1" onClick={() => void pickAndOpen('current')}>
            Open Folder…
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => void pickAndOpen('new')}>
            Open in New Window…
          </Button>
        </div>

        <CapsLabel className="border-t border-s3 px-4 py-2">Recent</CapsLabel>
        <div className="max-h-72 overflow-y-auto pb-2">
          {recent.length === 0 && (
            <div className="px-4 py-3 text-meta text-s7">No other projects yet.</div>
          )}
          {recent.map((entry) => (
            <RecentRow key={entry.root} entry={entry} />
          ))}
        </div>
      </ModalShell>

      <SwapConfirmDialog />
    </>
  );
}

function RecentRow({ entry }: { entry: RecentProjectView }): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => requestOpen(entry.root, 'current')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          requestOpen(entry.root, 'current');
        }
      }}
      className="slip group flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left hover:bg-s3"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sec text-s11">
          <span className="truncate">{entry.name}</span>
          {entry.open && (
            <span className="flex-none font-mono text-caps text-s7 uppercase">Open</span>
          )}
        </span>
        <span className="block truncate font-mono text-meta text-s7">{entry.root}</span>
      </span>
      <button
        type="button"
        aria-label={`Open ${entry.name} in a new window`}
        onClick={(e) => {
          e.stopPropagation();
          requestOpen(entry.root, 'new');
        }}
        className={cx(
          'slip flex-none cursor-pointer rounded-r1 px-2 py-1 font-mono text-meta text-s7',
          'opacity-0 hover:text-s11 focus-visible:opacity-100 group-hover:opacity-100',
        )}
      >
        New window
      </button>
    </div>
  );
}

/** F11's swap-in-current-window confirm (rule #3): raised only when swapping THIS window
 *  away from a session with a turn actively running — see `shouldConfirmSwap`. The one
 *  place that ever asks; every idle swap proceeds silently. */
function SwapConfirmDialog(): React.JSX.Element {
  const target = useShell((s) => s.confirmSwapProject);
  const setConfirm = useShell((s) => s.setConfirmSwapProject);

  return (
    <ModalShell
      open={target !== undefined}
      onClose={() => setConfirm(undefined)}
      aria-label="Confirm Project Switch"
      className="w-96"
    >
      {target !== undefined && (
        <>
          <div className="border-b border-s3 px-4 py-3 text-sec font-semibold text-s11">
            Switch to {target.name}?
          </div>
          <div className="px-4 py-4 text-code leading-relaxed text-s9">
            A turn is running in this window. Switching projects stops it.
          </div>
          <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
            <Button variant="outline" onClick={() => setConfirm(undefined)}>
              Cancel
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                const { root } = target;
                setConfirm(undefined);
                void performOpenProject(root, 'current');
              }}
            >
              <span className="text-crit">Switch Anyway</span>
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

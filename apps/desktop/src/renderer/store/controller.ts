import { pushSchema, pushToViewFrames } from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../../shared/settings.js';
import { surfaceWrite } from '../shell/failures.js';
import { useShell } from '../shell/store.js';
import { applySettings } from '../theme.js';
import { installActions } from './actions.js';
import * as agentOps from './agentOps.js';
import { settle, type ConsoleBridge } from './bridge.js';
import { setAccounts, setCatalogue, setModelMetadata, setModels, setSlowData } from './data.js';
import { detectAuthFailure, onModelsChanged, reportAuthFailure } from './notices.js';
import * as sessionOps from './sessionOps.js';
import type { SessionCtx } from './sessionOps.js';
import {
  clearAllRunStatus,
  clearPendingApprovals,
  clearRunStatus,
  enqueueApproval,
  markRunning,
  setSessionMode,
  setSessionUsage,
  useSessions,
} from './sessions.js';
import { appendFrames, evictColdest, flushFrames } from './transcripts.js';
import {
  mergeModelOverride,
  setSelectedAgent,
  setUiSettings,
  toggleRawMode,
  useConsoleUi,
} from './ui.js';

/**
 * How many session transcripts stay materialized at once.
 *
 * Not a setting: it is a memory bound, not a preference — there is nothing a person
 * would want to say about it that this number doesn't already say, and a wrong value
 * only ever costs a reload. Sized at twice the ~20-tab working set the instant-navigation
 * acceptance targets, so eviction only ever reaches transcripts whose tabs have been
 * closed for a while — a tab a user still has open is protected at any cap anyway.
 */
export const TRANSCRIPT_CAP = 40;

export interface ConsoleController {
  refresh(): Promise<void>;
  /** Re-run the one-shot boot loads. Recovers a cold boot where the daemon wasn't up yet
   *  when `startConsole` fired them (they settled into error Remotes and nothing else
   *  ever retries them) — call this when the daemon transitions to `running`. */
  hydrate(): Promise<void>;
  /** Forget every session this renderer believes is running — call it on the same daemon
   *  transition as `hydrate`, and before it. A fresh daemon connection cannot be running a
   *  turn this renderer started, so anything still in the map is a leftover claim. */
  clearRunState(): void;
  toggleRaw(): void;
  dispose(): void;
}

/**
 * The console composition root over the slice stores: binds the injected bridge to the
 * transcript/session/data/ui slices, owns the push routing and the boot/hydrate
 * sequencing, and installs the module-level action implementations. The stores are the
 * only render surface — nothing is published wholesale; each write lands in the slice
 * whose subscribers actually draw it.
 */
export async function startConsole(
  bridge: ConsoleBridge,
  sinks: { navigate: (surface: string) => void },
): Promise<ConsoleController> {
  const settings = await bridge.getSettings();
  applySettings(settings);
  setUiSettings(settings);

  // `live` is what keeps a disposed controller's unfinished work out of the slices — see
  // `SessionCtx.live`. Every read below lands its result only while it still holds.
  const ctx: SessionCtx & agentOps.AgentCtx = {
    bridge,
    attached: new Set(),
    youSeq: { n: 0 },
    live: true,
  };

  async function refresh(): Promise<void> {
    const [cap, flags, timeline] = await Promise.all([
      settle(() => bridge.capState()),
      settle(() => bridge.flagsForUser()),
      settle(() => bridge.listTimeline()),
    ]);
    if (!ctx.live) return;
    // Unchanged keys keep their references inside the slice, so a quiet 2s poll tick
    // re-renders nothing — and never touches the transcript or session slices at all.
    setSlowData({ cap, flags, timeline });
  }

  async function loadAccounts(): Promise<void> {
    // listAccounts carries the per-provider active map too, so one read suffices.
    const accounts = await settle(() => bridge.listAccounts());
    if (!ctx.live) return;
    setAccounts(accounts);
  }

  async function loadModels(): Promise<void> {
    const models = await settle(() => bridge.listModels());
    if (!ctx.live) return;
    setModels(models);
  }

  async function loadModelMetadata(): Promise<void> {
    const entries = await settle(async () => (await bridge.modelMetadata()).entries);
    if (!ctx.live) return;
    setModelMetadata(entries);
  }

  async function loadCatalogue(): Promise<void> {
    const [roles, packages] = await Promise.all([
      settle(() => bridge.listRoles()),
      settle(() => bridge.listPackages()),
    ]);
    if (!ctx.live) return;
    setCatalogue(roles, packages);
  }

  const switchAccount = (label: string, provider?: string): void =>
    void (async () => {
      const switched = await surfaceWrite(
        'switch accounts',
        bridge.useAccount({ label, ...(provider !== undefined ? { provider } : {}) }),
      );
      // The switch was refused and said so — the daemon is still on the old account, so
      // there is nothing new to read.
      if (switched === undefined) return;
      await loadAccounts();
      // The merged model list is per-account (that provider's models change) — refetch.
      await loadModels();
    })();

  const setSettings = (patch: Partial<ConsoleSettings>): void => {
    const next = { ...useConsoleUi.getState().settings, ...patch };
    applySettings(next);
    setUiSettings(next);
    // Defer the disk write until the renderer has painted the change (two frames) —
    // persisting is bookkeeping, never on the interaction path.
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void): unknown => setTimeout(cb, 0);
    raf(() =>
      raf(() => {
        void surfaceWrite('save that setting', bridge.saveSettings(next));
      }),
    );
  };

  const togglePinAgent = (ref: string): void => {
    const pinned = useConsoleUi.getState().settings.pinnedAgents;
    setSettings({
      pinnedAgents: pinned.includes(ref) ? pinned.filter((p) => p !== ref) : [...pinned, ref],
    });
  };

  /** Reveal a file (a tool card's path/match click) in the editor/OS at an optional line.
   *  Delegates to main, which owns the session→worktree mapping + confinement. Advisory:
   *  resolves the structured result; never throws (a rejected IPC becomes a failed result
   *  the caller can toast). */
  const openPath = (
    path: string,
    line: number | undefined,
    sessionId: string | undefined,
  ): Promise<{ ok: boolean; revealed?: 'editor' | 'folder'; reason?: string }> =>
    bridge
      .openPath({
        path,
        ...(line !== undefined ? { line } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
      })
      .catch((e: unknown) => ({
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
      }));

  /** Open a web URL (a tool card's WebSearch/WebFetch link) in the default browser. */
  const openExternal = (url: string): Promise<{ ok: boolean; reason?: string }> =>
    bridge.openExternal({ url }).catch((e: unknown) => ({
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    }));

  // Forward every daemon push to its owning session (never the active one blindly); a
  // completed session refreshes the rail so its auto-title + recency update.
  // (Drift/cache banners are derived client-side, not pushed.)
  const unsubscribePush = bridge.onPush((payload) => {
    const parsed = pushSchema.safeParse(payload);
    if (!parsed.success) return;
    const data = parsed.data;
    if (data.kind === 'status') {
      // Land any buffered stream frames before a terminal status renders (so the last text
      // is present when the pill clears), and guarantee the flush even if rAF is throttled.
      flushFrames();
      // `blocked-approval`/`blocked-tool` annotate a turn that is still genuinely in
      // flight underneath — NOT a "not running" signal. Every Stop/interrupt affordance
      // hangs off this claim, so treating a pending ask as idle would strand the user
      // with approve/deny and no way to abort the turn outright.
      if (
        data.state === 'running' ||
        data.state === 'blocked-approval' ||
        data.state === 'blocked-tool'
      ) {
        markRunning(data.sessionId);
      } else {
        clearRunStatus(data.sessionId);
      }
      // A terminal status carries NO transcript content: the daemon settles the in-flight
      // turn's partial blocks and records the `interrupted` marker as real, persisted
      // frames, which arrive on this same push stream. Closing blocks or synthesizing a
      // marker here would diverge from what a reload folds out of the log.
      //
      // It DOES end every pending ask: a request belongs to the turn that raised it, and
      // the daemon fail-safe-denies its own copy on this same transition — but that alone
      // never tells THIS console to drop the card it is still showing.
      if (data.state === 'done' || data.state === 'error' || data.state === 'interrupted') {
        clearPendingApprovals(data.sessionId);
      }
      if (data.state === 'done') void sessionOps.refreshSessionList(ctx);
      return;
    }
    if (data.kind === 'usage') {
      setSessionUsage(data.sessionId, {
        tokensIn: data.tokensIn,
        tokensOut: data.tokensOut,
        ...(data.cacheReadTokens !== undefined ? { cacheReadTokens: data.cacheReadTokens } : {}),
      });
      return;
    }
    // The mode-reflection push — the daemon is the ONE authority over a session's
    // permission mode; the console only ever mirrors it. `degraded` rides straight
    // through unchanged (the daemon's own honest wording — SC-1).
    if (data.kind === 'mode') {
      setSessionMode(data.sessionId, {
        mode: data.mode,
        effectiveMode: data.effectiveMode,
        ...(data.degraded !== undefined ? { degraded: data.degraded } : {}),
      });
      return;
    }
    if (data.kind === 'approval') {
      enqueueApproval(data.sessionId, {
        requestId: data.requestId,
        tool: data.tool ?? '',
        summary: data.summary,
        ...(data.input !== undefined ? { input: data.input } : {}),
        ...(data.toolClass !== undefined ? { toolClass: data.toolClass } : {}),
      });
      return;
    }
    if ('sessionId' in data) {
      const frames = pushToViewFrames(data);
      // Child announcements are session-level facts, not transcript content: they land in
      // the session slice BEFORE the frames themselves, so the dock and the rail already
      // agree by the time the transcript repaints.
      sessionOps.trackSubagentAnnouncements(ctx, frames);
      // The live-failure hook: an auth-shaped error frame flags the active claude login
      // (advisory — the badge lights; nothing blocks, nothing switches). Scoped to the
      // pushing session's own backend — a non-claude session's auth error has nothing
      // to do with the claude login and must not light that badge.
      if (detectAuthFailure(frames) && sessionOps.sessionUsesClaude(data.sessionId)) {
        reportAuthFailure();
      }
      appendFrames(data.sessionId, frames);
    }
  });

  // Every open tab stays materialized: any id entering the shell's working set
  // (a click, a session restore at boot, a reopened tab) is subscribed + hydrated
  // immediately, so its activation later is a pure display swap. This is the ONE
  // materialization trigger besides activation itself.
  //
  // The same pass is where the working set gets its memory bound: a closed tab keeps its
  // transcript (reopening it is then free), so without a cap every conversation ever
  // opened in this window would be held for the window's lifetime. Eviction is driven
  // from HERE rather than from the slice because only the controller knows both halves —
  // the shell's open tabs (never evictable: each is a mounted host) and the attached set,
  // which an evicted session must leave or `ensureMaterialized` would early-return on it
  // forever and the tab would render permanently empty.
  const syncWorkingSet = (tabs: string[]): void => {
    if (!ctx.live) return;
    for (const id of tabs) sessionOps.ensureMaterialized(ctx, id);
    const active = useSessions.getState().activeSessionId;
    const mounted = active === undefined ? tabs : [...tabs, active];
    for (const evicted of evictColdest(mounted, TRANSCRIPT_CAP)) ctx.attached.delete(evicted);
  };
  const unsubscribeTabs = useShell.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs) syncWorkingSet(s.tabs);
  });

  /** On launch, load the project's sessions and open the most recent one. */
  async function initSessions(): Promise<void> {
    await sessionOps.refreshSessionList(ctx);
    if (!ctx.live) return;
    const newest = useSessions.getState().list;
    const first = newest.status === 'ok' ? newest.value[0] : undefined;
    if (first) sessionOps.activateSession(ctx, first.id);
    else sessionOps.clearActiveSession();
    // Tabs restored by layout persistence may already be sitting in the shell store
    // (the subscription above only fires on CHANGES) — materialize whatever is there.
    syncWorkingSet(useShell.getState().tabs);
  }

  installActions({
    setRoute: (panelId) => sinks.navigate(panelId),
    refresh: () => void refresh(),
    switchAccount,
    setSettings,
    toggleRaw: toggleRawMode,
    respondApproval: (requestId, decision) => sessionOps.respondApproval(ctx, requestId, decision),
    setPermissionMode: (sessionId, mode) => sessionOps.setPermissionMode(ctx, sessionId, mode),
    selectAgent: (ref) => setSelectedAgent(ref),
    createAgent: (scope) => agentOps.createAgent(ctx, scope),
    updateAgent: (ref, patch) => agentOps.updateAgent(ctx, ref, patch),
    deleteAgent: (ref) => agentOps.deleteAgent(ctx, ref),
    togglePinAgent,
    selectSession: (id) => sessionOps.activateSession(ctx, id),
    newSession: (agentRef) => sessionOps.newSession(ctx, agentRef),
    deleteSession: (id) => sessionOps.deleteSession(ctx, id),
    sendMessage: (text, attachments, invokeSkills) =>
      sessionOps.sendMessage(ctx, text, attachments, invokeSkills),
    onBannerAction: (sessionId, bannerId, actionId) =>
      sessionOps.onBannerAction(ctx, sessionId, bannerId, actionId),
    setSessionModel: (sessionId, selection) => mergeModelOverride(sessionId, selection),
    openPath,
    openExternal,
    interruptSession: (sessionId) => sessionOps.interruptSession(ctx, sessionId),
    steerSession: (sessionId, text) => sessionOps.steerSession(ctx, sessionId, text),
    reapWorktree: (sessionId) => sessionOps.reapWorktree(ctx, sessionId),
  });

  // The modelsStore's writes reproject the daemon's edited catalog into its own state,
  // but the chip/agent-picker feed lives on the data slice — poke `loadModels` too, in
  // the same breath, so both surfaces agree the moment an edit lands.
  onModelsChanged(loadModels);

  // Fire-and-forget as a group, but TRACKED: on an ordinary launch (daemon already up)
  // the daemon-status handler fires `cameUp` at startup too, so an untracked `hydrate()`
  // could run its guard before the boot-time `initSessions()` settles and kick off a
  // second, concurrent one. `allSettled` (not `all`) because a failed read must not
  // short-circuit the others — each settles into its own error Remote for hydrate to
  // recover.
  let bootSettled = false;
  const bootLoads = Promise.allSettled([
    loadAccounts(),
    loadModels(),
    loadModelMetadata(),
    loadCatalogue(),
    agentOps.initAgents(ctx),
    initSessions(),
    sessionOps.loadWorktrees(ctx),
  ]).then(() => {
    bootSettled = true;
  });

  /** Recover the one-shot boot loads (cold-boot rehydrate gap): a `cameUp` daemon-status
   *  transition fires on BOTH a cold boot (autostart racing the console mount) and a
   *  daemon RESTART mid-use. The list reads are idempotent and safe to re-run either
   *  way. `initSessions` is NOT idempotent — it jumps the view to the newest session —
   *  so it only re-runs when the sessions read isn't ok or nothing is active yet (the
   *  cold-boot case); a mid-use restart with a healthy, already-active session must not
   *  yank the user to a different conversation.
   *
   *  A new daemon connection also invalidates every attachment: the fresh daemon has no
   *  idea this renderer was subscribed, so every open tab re-attaches (subscribe +
   *  reload-merge). A session the new daemon does not hold answers `subscribed: false`,
   *  which clears its stale run claim through the ordinary reattach path. */
  async function hydrate(): Promise<void> {
    // A `cameUp` that arrives while the boot loads are still in flight is the ordinary
    // launch race — the boot attach below runs against this very connection, so nothing
    // needs re-attaching (re-attaching here would double every subscribe/reload on every
    // normal launch). A `cameUp` AFTER boot settled means the previous daemon connection
    // died: every attachment is stale and every open tab re-attaches.
    const freshConnection = bootSettled;
    await bootLoads;
    await Promise.all([
      loadAccounts(),
      loadModels(),
      loadModelMetadata(),
      loadCatalogue(),
      agentOps.initAgents(ctx),
      sessionOps.loadWorktrees(ctx),
    ]);
    if (!ctx.live) return;
    if (freshConnection) ctx.attached.clear();
    const sessions = useSessions.getState();
    if (sessions.list.status !== 'ok' || sessions.activeSessionId === undefined) {
      await initSessions();
    } else if (freshConnection) {
      sessionOps.ensureMaterialized(ctx, sessions.activeSessionId);
      syncWorkingSet(useShell.getState().tabs);
    }
  }

  return {
    refresh,
    hydrate,
    clearRunState: clearAllRunStatus,
    toggleRaw: toggleRawMode,
    dispose: () => {
      // Unsubscribing only stops what has not arrived yet. Everything already in flight —
      // the boot reads, a poll tick, a cold open's reload — still resolves, and on a
      // project swap it resolves after the slices were reset for the new project. Marking
      // the ctx dead is what makes those continuations land nowhere.
      ctx.live = false;
      unsubscribePush();
      unsubscribeTabs();
    },
  };
}

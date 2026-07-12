import {
  Banner as BannerCard,
  Button,
  InlineMessage,
  PaneOverlayProvider,
  Skeleton,
  Toast,
  ToastProvider,
  Transcript,
} from '@coa/console-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RespondFn, TranscriptFrame } from '@coa/console-ui';
import type { Banner, ModelDescriptor, TurnFrame } from '@coa/console-viewmodel';
import { effortOptions, reasoningValue, toReasoning } from '@coa/console-viewmodel';
import { modelPickerLabel } from './AgentsPanel.js';
import { computeChatBanners } from './banners.js';
import { Composer } from './Composer.js';
import type { ConsoleState } from './state.js';

// Frame identity caches: the wire `TurnFrame` objects in `state.data.turns.value` are
// STABLE across renders (`appendTurns` builds `[...prev, ...new]`, so previously-seen
// turns keep their object identity). `toGovernedFrame`/`frameToRawLine` are pure
// functions of `f` alone, so their outputs can be cached by `f` identity — this is what
// lets `Transcript`'s `MemoRow` (a `React.memo` keyed on the frame prop) actually hit
// instead of re-rendering the whole transcript on every streamed frame.
const governedFrameCache = new WeakMap<TurnFrame, TranscriptFrame>();
const rawFrameCache = new WeakMap<TurnFrame, TranscriptFrame>();

export type ChatVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      rawMode: boolean;
      frames: TranscriptFrame[];
      /** The newest unresolved approval, docked to the composer instead of the
       *  transcript (it blocks the input, so it belongs at the input). `frames`
       *  omits it (governed mode only — raw stays untouched); a resolved approval
       *  stays in `frames` as the one-line receipt. Undefined when nothing is
       *  pending. */
      approval?: { id: string; tool: string; summary: string; diffStat?: string | undefined } | undefined;
      /** System banners (drift/cache notices) for the active session — surfaced above
       *  the transcript, never sent to the agent. */
      banners: Banner[];
      onBannerAction: (bannerId: string, actionId: string) => void;
      /** The merged model list + the active session's current model, for the in-chat
       *  switch. Picking one re-pins the session (and can raise the cache banner). */
      models: ModelDescriptor[];
      currentModelId?: string | undefined;
      onPickModel: (modelId: string) => void;
      /** The reasoning-effort control for the current model — empty when the model
       *  doesn't support effort (the control hides). */
      effortOptions: { value: string; label: string }[];
      effortValue: string;
      onPickEffort: (v: string) => void;
      onRespond: RespondFn;
      onSend: (text: string) => void;
      /** The Stop/Esc affordance — cooperatively interrupts the active session's running
       *  turn (SC-1: a user stop, never a governance block; D85: unpressed, nothing
       *  changes). A no-op with no active session (Composer only surfaces Stop while
       *  running, which implies one). */
      onInterrupt: () => void;
      /** Barge-in: redirect the running turn with a message (the composer's Enter/Interrupt
       *  default while running). A no-op with no active session. */
      onBargeIn: (text: string) => void;
      /** Reveal a tool card's touched file in the editor/OS at an optional line. Stable
       *  action identity (from `state.actions`) so it can be threaded into the memoized
       *  transcript rows; resolves an advisory result the view toasts on failure. */
      openPath: (
        path: string,
        line: number | undefined,
        sessionId: string | undefined,
      ) => Promise<{ ok: boolean; revealed?: 'editor' | 'folder'; reason?: string }>;
      /** Open a tool card's WebSearch/WebFetch link in the default browser. Stable action
       *  identity (from `state.actions`) so it threads into the memoized transcript rows;
       *  resolves an advisory result the view toasts on failure. */
      openExternal: (url: string) => Promise<{ ok: boolean; reason?: string }>;
      toggleRaw: () => void;
      /** The active session id, if any — drives the composer's disabled/hint state
       *  (no session means nothing to send a message into). Session switching itself
       *  lives in the shell now (title-bar tabs + the ⌕ browser) — this vm carries only
       *  the transcript/composer concern. */
      activeSessionId?: string | undefined;
      /** The active session's agent name — feeds the empty state's "`{agent}` is
       *  ready" line. Undefined with no active session/agent. */
      agentName?: string | undefined;
      /** Phase-1 status floor — `running` while a send is in flight, cleared on the next
       *  appended turn. The full 6-state `status` Push (Phase 2) replaces this. */
      sessionStatus: 'idle' | 'running';
      /** Epoch ms the in-flight send started; set only while `sessionStatus === 'running'`. */
      runningSince?: number;
      /** Bumped on every send for the active session — passed through as the
       *  transcript's `jumpNonce` so sending snaps the view to the new turn even after
       *  a manual scroll-up. */
      sendNonce: number;
    };

/** Map a daemon turn frame to its governed transcript frame. Approvals/denies pass
 *  their fields straight through; `resolved` is layered on in a later part from ui state. */
export function toGovernedFrame(f: TurnFrame): TranscriptFrame {
  switch (f.kind) {
    case 'text':
      return {
        id: f.id,
        role: f.role,
        kind: 'text',
        text: f.text,
        depth: f.depth,
        ...(f.streaming !== undefined ? { streaming: f.streaming } : {}),
      };
    case 'tool-use':
      return {
        id: f.id,
        role: f.role,
        kind: 'tool-use',
        tool: f.tool,
        input: f.input,
        handle: f.handle,
        depth: f.depth,
      };
    case 'tool-result':
      return {
        id: f.id,
        role: f.role,
        kind: 'tool-result',
        tool: f.tool,
        output: f.output,
        ok: f.ok,
        handle: f.handle,
        depth: f.depth,
      };
    case 'approval':
      return {
        id: f.id,
        kind: 'approval',
        requestId: f.requestId,
        tool: f.tool,
        summary: f.summary,
        diffStat: f.diffStat,
      };
    case 'deny':
      return { id: f.id, kind: 'deny', denyKind: f.denyKind, reason: f.reason };
    case 'interrupted':
      // A user stop renders as the quiet centered system line (the `note` presentation) — never
      // a chat bubble (the user didn't type it) and never an error tone (SC-1).
      return { id: f.id, kind: 'note', text: 'Request interrupted by user' };
    case 'thinking':
      return {
        id: f.id,
        role: f.role,
        kind: 'thinking',
        text: f.text,
        depth: f.depth,
        ...(f.streaming !== undefined ? { streaming: f.streaming } : {}),
        ...(f.durationMs !== undefined ? { durationMs: f.durationMs } : {}),
      };
    case 'error':
      return { id: f.id, role: f.role, kind: 'error', message: f.message, origin: f.origin, depth: f.depth };
    case 'plan':
      return { id: f.id, role: f.role, kind: 'plan', items: f.items, depth: f.depth };
    case 'subagent':
      return {
        id: f.id,
        kind: 'subagent',
        childWorktree: f.childWorktree,
        event: f.event,
        depth: f.depth,
        rollup: f.rollup,
      };
  }
}

/** The verbatim (unfiltered-loop) projection of one frame. Mock stand-in for the
 *  turn store's raw bytes; rendered byte-faithfully via the Code block (D128). */
export function frameToRawLine(f: TurnFrame): string {
  switch (f.kind) {
    case 'text':
      return `> ${f.role}: ${f.text}`;
    case 'tool-use':
      return `> ${f.role}: tool_use ${f.tool} ${f.input}`;
    case 'tool-result':
      return `> ${f.role}: tool_result ${f.tool} ${f.ok ? 'ok' : 'error'} ${f.output}`;
    case 'approval':
      return `> control: approval_request ${f.tool} (${f.requestId})`;
    case 'deny':
      return `> control: deny ${f.denyKind} ${f.reason}`;
    case 'interrupted':
      return `> control: interrupted`;
    case 'thinking':
      return `> ${f.role}: thinking ${f.text}`;
    case 'error':
      return `> ${f.role}: error ${f.message}`;
    case 'plan':
      return `> ${f.role}: plan ${f.items.map((i) => `[${i.status}] ${i.text}`).join('; ')}`;
    case 'subagent':
      return `> control: subagent ${f.event} ${f.childWorktree}`;
  }
}

/** Pure: seconds elapsed since `sinceMs`, formatted for the running-status pill. */
export function formatElapsed(sinceMs: number, nowMs: number): string {
  return `${Math.floor((nowMs - sinceMs) / 1000)}s`;
}

/** Compact relative age for session rows ('now', '5m', '2h', '3d'). */
export function relativeTime(iso: string, nowIso: string): string {
  const ms = Date.parse(nowIso) - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Pure: splices console-local "switched model" notes into a governed frame list,
 *  positioned by each note's `afterCount` (the number of turn-derived frames already
 *  appended when the note was recorded) — so a note lands right after the send it
 *  describes. An `afterCount` past the end of `frames` appends at the end (defensive:
 *  should not happen live, since notes are recorded against the same buffer they're
 *  later spliced into). Never called in raw mode — a UI note isn't loop output, so
 *  `coa raw` omits it (D85: raw is the verbatim, unfiltered projection). Exported for
 *  unit testing independent of the whole vm. */
export function interleaveNotes(
  frames: TranscriptFrame[],
  notes: { afterCount: number; text: string }[],
  sessionId = '',
): TranscriptFrame[] {
  if (notes.length === 0) return frames;
  const result: TranscriptFrame[] = [...frames];
  // Insert from the end backward so earlier insertions don't shift later afterCount
  // offsets (which are all expressed against the ORIGINAL frame list).
  const ordered = notes.map((n, i) => ({ ...n, index: i })).sort((a, b) => b.afterCount - a.afterCount);
  for (const note of ordered) {
    const at = Math.min(Math.max(note.afterCount, 0), result.length);
    result.splice(at, 0, { id: `note:${sessionId}:${note.index}`, kind: 'note', text: note.text });
  }
  return result;
}

/** Pure: projects the polled turn stream + agent/session state into the chat vm.
 *  In raw mode every frame becomes its verbatim line (D85); "switched model" notes are
 *  a console-local synthetic frame (never sent to the agent) interleaved only in
 *  governed mode — raw stays the verbatim, unfiltered projection. */
export function selectChatVm(state: ConsoleState, nowIso = new Date().toISOString()): ChatVm {
  const r = state.data.turns;
  if (r.status !== 'ok') return r;
  const agents = state.data.agents.status === 'ok' ? state.data.agents.value : [];
  const sessions = state.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const { rawMode, resolvedApprovals, activeSessionId } = state.ui;
  const governedFrames = r.value.map((f) => {
    let base = governedFrameCache.get(f);
    if (base === undefined) {
      base = toGovernedFrame(f);
      governedFrameCache.set(f, base);
    }
    // The approval-resolved overlay depends on ui state, so it is layered on fresh each
    // time (never cached) — every other frame reuses its cached, stable identity.
    if (base.kind === 'approval' && resolvedApprovals[base.requestId] !== undefined) {
      return { ...base, resolved: resolvedApprovals[base.requestId] };
    }
    return base;
  });
  // The pending approval — the newest governed approval frame still unresolved — is
  // lifted out of the transcript and docked to the composer instead (it blocks the
  // input, so it belongs at the input). Raw mode stays the untouched, verbatim
  // projection: an approval never surfaces there at all (D85).
  const pendingApproval = rawMode
    ? undefined
    : [...governedFrames]
        .reverse()
        .find((f): f is Extract<TranscriptFrame, { kind: 'approval' }> =>
          f.kind === 'approval' && f.resolved === undefined,
        );
  const frames: TranscriptFrame[] = rawMode
    ? r.value.map((f) => {
        let raw = rawFrameCache.get(f);
        if (raw === undefined) {
          raw = { id: f.id, kind: 'raw', text: frameToRawLine(f) };
          rawFrameCache.set(f, raw);
        }
        return raw;
      })
    : interleaveNotes(
        pendingApproval !== undefined
          ? governedFrames.filter((f) => f.id !== pendingApproval.id)
          : governedFrames,
        activeSessionId !== undefined ? (state.ui.notesBySession[activeSessionId] ?? []) : [],
        activeSessionId ?? '',
      );
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const models = state.data.models.status === 'ok' ? state.data.models.value : [];
  const activeAgent = agents.find((a) => a.ref === activeSession?.agentRef);
  const override = activeSessionId ? state.ui.modelOverride[activeSessionId] : undefined;
  // Predictive banners: derived from the pending pick + the running prompt's config the
  // session reports, so they appear the moment a model/config is changed (before send).
  const banners = computeChatBanners({
    ...(override !== undefined ? { override } : {}),
    ...(activeSession !== undefined
      ? {
          pinned: {
            ...(activeSession.provider !== undefined ? { provider: activeSession.provider } : {}),
            ...(activeSession.model !== undefined ? { model: activeSession.model } : {}),
            updatedAt: activeSession.updatedAt,
          },
        }
      : {}),
    ...(activeSession?.promptConfig !== undefined ? { frozenConfig: activeSession.promptConfig } : {}),
    agentConfig: {
      ...(activeAgent?.roles !== undefined ? { roles: activeAgent.roles } : {}),
      ...(activeAgent?.packageIds !== undefined ? { packageIds: activeAgent.packageIds } : {}),
      ...(activeAgent?.exclude !== undefined ? { exclude: activeAgent.exclude } : {}),
    },
    ...(activeSessionId !== undefined && state.ui.dismissedDrift[activeSessionId] !== undefined
      ? { dismissedDriftKey: state.ui.dismissedDrift[activeSessionId] }
      : {}),
    now: nowIso,
  });
  // The model the next turn will run on: a deliberate in-chat override, else the
  // session's pin, else the agent's default.
  const currentModelId = override?.model ?? activeSession?.model ?? activeAgent?.model;
  const currentModel = models.find((m) => m.id === currentModelId);
  const effortOpts = effortOptions(currentModel);
  const effortVal = reasoningValue(override?.reasoning ?? activeSession?.reasoning ?? activeAgent?.reasoning);
  const active = activeSessionId ? state.ui.runStatus[activeSessionId] : undefined;
  return {
    status: 'ready',
    rawMode,
    frames,
    ...(pendingApproval !== undefined
      ? {
          approval: {
            id: pendingApproval.requestId,
            tool: pendingApproval.tool,
            summary: pendingApproval.summary,
            ...(pendingApproval.diffStat !== undefined ? { diffStat: pendingApproval.diffStat } : {}),
          },
        }
      : {}),
    banners,
    onBannerAction: (bannerId, actionId) => {
      if (activeSessionId !== undefined)
        state.actions.onBannerAction(activeSessionId, bannerId, actionId);
    },
    models,
    currentModelId,
    onPickModel: (modelId) => {
      if (activeSessionId === undefined) return;
      // Carry the model's provider so the session routes to the right backend as a unit.
      const picked = models.find((m) => m.id === modelId);
      state.actions.setSessionModel(activeSessionId, {
        model: modelId,
        ...(picked?.provider !== undefined ? { provider: picked.provider } : {}),
      });
    },
    effortOptions: effortOpts,
    effortValue: effortVal,
    onPickEffort: (v) => {
      if (activeSessionId !== undefined)
        state.actions.setSessionModel(activeSessionId, { reasoning: toReasoning(v) });
    },
    onRespond: state.actions.respondApproval,
    onSend: state.actions.sendMessage,
    onInterrupt: () => {
      if (activeSessionId !== undefined) state.actions.interruptSession(activeSessionId);
    },
    onBargeIn: (text: string) => {
      if (activeSessionId !== undefined) state.actions.steerSession(activeSessionId, text);
    },
    openPath: state.actions.openPath,
    openExternal: state.actions.openExternal,
    toggleRaw: state.actions.toggleRaw,
    activeSessionId,
    ...(activeAgent?.name !== undefined ? { agentName: activeAgent.name } : {}),
    sessionStatus: active ? 'running' : 'idle',
    ...(active ? { runningSince: active.since } : {}),
    sendNonce: activeSessionId !== undefined ? (state.ui.sendNonce[activeSessionId] ?? 0) : 0,
  };
}

/** A short title per banner kind (the reason carries the detail). */
function bannerTitle(kind: Banner['kind']): string {
  return kind === 'drift' ? 'Prompt out of date' : 'Prompt cache';
}

/** System banners (drift/cache notices) above the transcript: the reason plus any
 *  resolution buttons. System-only — a banner is never part of the agent transcript. */
function BannerStrip({
  banners,
  onAction,
}: {
  banners: Banner[];
  onAction: (bannerId: string, actionId: string) => void;
}): React.JSX.Element | null {
  if (banners.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-b border-border-default p-2.5">
      {banners.map((b) => (
        <BannerCard
          key={b.id}
          tone="warning"
          title={bannerTitle(b.kind)}
          // Only the actionable drift banner is dismissable; the cache notice is passive
          // and auto-clears when the pending pick is sent or reverted.
          {...(b.kind === 'drift' ? { onDismiss: () => onAction(b.id, 'dismiss') } : {})}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0">{b.reason}</span>
            {b.actions && b.actions.length > 0 && (
              <div className="flex shrink-0 items-center gap-1.5">
                {b.actions.map((a) => (
                  <Button
                    key={a.id}
                    variant={a.primary ? 'primary' : 'tertiary'}
                    size="sm"
                    onClick={() => onAction(b.id, a.id)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </BannerCard>
      ))}
    </div>
  );
}

/** A fresh session: teach the register in three quiet lines — who is ready, on
 *  what, and how to speak. Sits above center so the composer's floor doesn't
 *  crowd it. Ported from the proto's `EmptyConversation` (apps/workbench-proto/
 *  src/chat/Transcript.tsx). Permission is a presentational placeholder (SC-1 —
 *  a future M3 permission gate owns real enforcement), matching the composer's
 *  own default. */
function EmptyConversation({
  agent,
  model,
  effort,
}: {
  agent: string;
  model: string;
  effort: string;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 pb-32">
      <span aria-hidden className="font-mono text-[26px] text-s5">
        ❯
      </span>
      <div className="text-body text-s9">
        <b className="font-[550] text-s10">{agent}</b> is ready
      </div>
      <div className="font-mono text-meta text-s6">
        {model} · {effort} · ask edits
      </div>
      <div className="mt-3 flex items-center gap-4 font-mono text-meta text-s6">
        <span>
          <kbd className="rounded-r1 border border-s4 px-1 py-px text-s7">⏎</kbd> send
        </span>
        <span>
          <kbd className="rounded-r1 border border-s4 px-1 py-px text-s7">⇧⏎</kbd> newline
        </span>
        <span>
          <kbd className="rounded-r1 border border-s4 px-1 py-px text-s7">⌘K</kbd> commands
        </span>
      </div>
    </div>
  );
}

function ChatView({ vm }: { vm: ChatVm }): React.JSX.Element {
  const [composerHeight, setComposerHeight] = useState(0);
  const composerRoRef = useRef<ResizeObserver | null>(null);
  // A failed reveal-in-editor surfaces as a toast (SC-1 — surface, never block).
  const [revealError, setRevealError] = useState<string | null>(null);

  // Queued follow-up messages (the composer's Queue action while a turn runs), held per active
  // session and released one at a time (FIFO) as a normal send when that session's turn ends. Kept
  // console-side so they stay visibly PINNED above the composer until they run; barge-in messages
  // skip the queue and redirect the running turn immediately (via `onBargeIn`).
  const [queuedBySession, setQueuedBySession] = useState<Record<string, string[]>>({});
  const vmRef = useRef(vm);
  vmRef.current = vm;
  const activeId = vm.status === 'ready' ? vm.activeSessionId : undefined;
  const running = vm.status === 'ready' && vm.sessionStatus === 'running';
  const activeQueue = activeId !== undefined ? (queuedBySession[activeId] ?? []) : [];

  // Release the oldest queued message when the active session goes running → idle. Sending it
  // flips the session back to running, so any remaining queued messages wait for the next boundary.
  const prevRunningRef = useRef(running);
  useEffect(() => {
    if (prevRunningRef.current && !running && activeId !== undefined) {
      const next = (queuedBySession[activeId] ?? [])[0];
      if (next !== undefined) {
        setQueuedBySession((m) => ({ ...m, [activeId]: (m[activeId] ?? []).slice(1) }));
        const cur = vmRef.current;
        if (cur.status === 'ready') cur.onSend(next);
      }
    }
    prevRunningRef.current = running;
  }, [running, activeId, queuedBySession]);

  // The composer's Queue action while a turn runs: append to the active session's
  // queue (barge-in skips the queue entirely — it routes straight to `vm.onBargeIn`).
  const handleQueue = useCallback((text: string): void => {
    const cur = vmRef.current;
    if (cur.status !== 'ready' || cur.activeSessionId === undefined) return;
    const id = cur.activeSessionId;
    setQueuedBySession((m) => ({ ...m, [id]: [...(m[id] ?? []), text] }));
  }, []);

  const dequeue = useCallback((index: number): void => {
    const cur = vmRef.current;
    const id = cur.status === 'ready' ? cur.activeSessionId : undefined;
    if (id === undefined) return;
    setQueuedBySession((m) => ({ ...m, [id]: (m[id] ?? []).filter((_, i) => i !== index) }));
  }, []);

  // Read the reveal action + active session through refs so the `onOpenPath` handed to
  // the memoized transcript rows keeps a STABLE identity across renders (the vm — hence
  // `vm.openPath`/`vm.activeSessionId` — is rebuilt every render; threading them directly
  // would defeat `MemoRow`'s memoization). The action itself is already stable; the ref
  // just lets one stable closure always see the current session.
  const openPathRef = useRef(vm.status === 'ready' ? vm.openPath : undefined);
  const openUrlRef = useRef(vm.status === 'ready' ? vm.openExternal : undefined);
  const sessionIdRef = useRef<string | undefined>(undefined);
  openPathRef.current = vm.status === 'ready' ? vm.openPath : undefined;
  openUrlRef.current = vm.status === 'ready' ? vm.openExternal : undefined;
  sessionIdRef.current = vm.status === 'ready' ? vm.activeSessionId : undefined;

  const onOpenPath = useCallback((path: string, line?: number): void => {
    const open = openPathRef.current;
    if (open === undefined) return;
    void open(path, line, sessionIdRef.current).then((res) => {
      if (!res.ok) setRevealError(res.reason ?? 'Could not open the file.');
    });
  }, []);

  // A tool card's web link opens in the default browser (via the openExternal IPC, which
  // validates the scheme). Stable identity (ref pattern) so it threads into the memoized
  // transcript rows without defeating `MemoRow`'s memoization. A failed open toasts (SC-1).
  const onOpenUrl = useCallback((url: string): void => {
    const open = openUrlRef.current;
    if (open === undefined) return;
    void open(url).then((res) => {
      if (!res.ok) setRevealError(res.reason ?? 'Could not open the URL.');
    });
  }, []);

  // Measure the floating composer's rendered height (it grows as the textarea does)
  // via a CALLBACK ref, not a mount-time effect. The composer only mounts once the
  // session is `ready`, which is a later render than ChatView's first (loading)
  // render — a `useLayoutEffect([])` would run while the node is still absent and,
  // with empty deps, never re-attach, leaving the height stuck at 0 (so nothing
  // reserves space for the composer). A callback ref runs exactly on mount/unmount.
  //
  // The composer self-positions (`absolute`), so THIS wrapper is a plain,
  // non-positioning box that never grows to its child's size — observe the
  // composer's own rendered root element (the wrapper's first child) instead.
  const composerRef = useCallback((el: HTMLDivElement | null): void => {
    composerRoRef.current?.disconnect();
    composerRoRef.current = null;
    if (el === null) return;
    const target = el.firstElementChild;
    if (target === null) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setComposerHeight(entry.contentRect.height);
    });
    ro.observe(target);
    composerRoRef.current = ro;
  }, []);

  if (vm.status !== 'ready') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-s1 p-3.5">
        {vm.status === 'loading' && (
          <div className="flex flex-col gap-2">
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/2" />
          </div>
        )}
        {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      </div>
    );
  }
  const queuedMessages = activeQueue.map((text, i) => ({ id: String(i), text }));
  const currentModelDesc = vm.models.find((m) => m.id === vm.currentModelId);
  const currentModelLabel =
    currentModelDesc !== undefined ? modelPickerLabel(currentModelDesc) : (vm.currentModelId ?? 'model');
  const currentEffortLabel =
    vm.effortOptions.find((e) => e.value === vm.effortValue)?.label ?? vm.effortValue;
  return (
    <ToastProvider>
      {/* Session-switching chrome (title bar, session switcher, agent rail) is retired here —
          the shell's title-bar tabs + ⌕ browser own switching now (docs/design plan A1). This
          is a plain layout container, not a re-styled Pane — the running/needs-you state now
          lives on the composer's own edge (its status-outline shimmer). */}
      <div className="flex h-full min-h-0 flex-col bg-s1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <BannerStrip banners={vm.banners} onAction={vm.onBannerAction} />
          {/* The transcript fills the pane; the composer floats over its bottom edge
              (below) so the transcript stays visible around/behind it. The transcript's
              own scroll region reserves `composerHeight` of bottom inset so the last row
              clears the floating composer when scrolled fully down.

              PaneOverlayProvider hosts a tool card's Expand overlay CONFINED to this
              transcript box (`absolute inset-0` within its own `relative` container) — so
              expanding a deeply-scrolled row covers the transcript region only, never the
              window, and the floating composer stays over its bottom edge. */}
          <PaneOverlayProvider className="flex-1 bg-s1">
            {vm.frames.length === 0 ? (
              <EmptyConversation
                agent={vm.agentName ?? 'agent'}
                model={currentModelLabel}
                effort={currentEffortLabel}
              />
            ) : (
              <Transcript
                // Keyed per conversation so switching sessions REMOUNTS the transcript: the
                // block-entrance gate (`liveMountReady`) only suppresses history on a fresh
                // mount, so a persisted instance would replay the blur-in for every already-
                // seen block of the session you switch into. Remounting re-runs that
                // suppression for the incoming history; only genuinely live arrivals animate.
                key={vm.activeSessionId ?? 'none'}
                frames={vm.frames}
                onOpenPath={onOpenPath}
                onOpenUrl={onOpenUrl}
                label="Conversation"
                busy={vm.sessionStatus === 'running'}
                busySince={vm.runningSince}
                jumpNonce={vm.sendNonce}
                bottomInset={composerHeight}
              />
            )}
          </PaneOverlayProvider>
          {/* A plain, non-positioning wrapper — the composer self-positions
              (`absolute bottom-4 left-1/2 …`) against this pane's own `relative`
              container above, not against this wrapper. It exists only to host
              the height-measuring ResizeObserver (see `composerRef`) and to
              give the composer's focused Escape a place to fall through to the
              Stop affordance (SC-1: a user stop, never a governance block). */}
          <div
            ref={composerRef}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && vm.sessionStatus === 'running') {
                e.preventDefault();
                vm.onInterrupt();
              }
            }}
          >
            <Composer
              running={vm.sessionStatus === 'running'}
              disabled={vm.activeSessionId === undefined}
              queued={queuedMessages}
              approval={vm.approval}
              models={vm.models.map((m) => ({ id: m.id, label: modelPickerLabel(m) }))}
              currentModelId={vm.currentModelId}
              onPickModel={vm.onPickModel}
              effortOptions={vm.effortOptions}
              effortValue={vm.effortValue}
              onPickEffort={vm.onPickEffort}
              onSend={vm.onSend}
              onQueue={handleQueue}
              onBarge={vm.onBargeIn}
              onStop={vm.onInterrupt}
              onRemoveQueued={(id) => dequeue(Number(id))}
              onApprove={(id) => vm.onRespond(id, 'approve')}
              onDeny={(id) => vm.onRespond(id, 'deny')}
              onRedirect={(id, text) => {
                vm.onRespond(id, 'deny');
                vm.onSend(text);
              }}
            />
          </div>
        </div>
      </div>
      <Toast
        open={revealError !== null}
        onOpenChange={(open) => {
          if (!open) setRevealError(null);
        }}
        tone="danger"
        title="Couldn't open"
      >
        {revealError}
      </Toast>
    </ToastProvider>
  );
}

/** State-fed surface: computes the vm from console state and renders the chat pane. */
export function ChatSurface({ state }: { state: ConsoleState }): React.JSX.Element {
  return <ChatView vm={selectChatVm(state)} />;
}

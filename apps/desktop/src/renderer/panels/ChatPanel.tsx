import { InlineMessage, Spinner } from '@coa/console-kit';
import { Transcript } from '@coa/console-transcript';
import { PaneOverlayProvider } from '@coa/console-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RespondFn, TranscriptFrame } from '@coa/console-transcript';
import type {
  Attachment,
  AttachControlVm,
  InvocableSkill,
  ModelDescriptor,
  ModelMetadata,
  PermissionMode,
  SessionUsage,
  TurnFrame,
} from '@coa/console-viewmodel';
import {
  attachControlState,
  effortOptions,
  findModelMetadata,
  providerCarriesAttachments,
  reasoningValue,
  toReasoning,
} from '@coa/console-viewmodel';
import { DeferredCanvas, Freeze } from '../shell/deferredMount.js';
import { reportFailure } from '../shell/failures.js';
import { matchesFind } from '../shell/keys.js';
import { useShell } from '../shell/store.js';
import { modelPickerLabel } from './AgentsPanel.js';
import { computeChatBanners, resolvableSkillSelection, type ChatNotice } from './banners.js';
import { Composer } from './Composer.js';
import { useLibraryStore } from './libraryStore.js';
import type { ConsoleState } from './state.js';

// Keep-alive tab caches (module scope — they outlive renders): the last frames
// and send-nonce each session rendered with, so a hidden tab keeps its DOM
// showing what it last showed. The ACTIVE tab always renders the live vm.
const framesBySession = new Map<string, TranscriptFrame[]>();
const nonceBySession = new Map<string, number>();

/** Keep the last real composer measure — a hidden (display:none) pass reports
 *  0, which would collapse the transcript's reserve spacer and make its return
 *  re-pin the view (a visible upward jump on exiting search). */
export const composerMeasure = (prev: number, next: number): number => (next > 0 ? next : prev);

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
      approval?:
        | { id: string; tool: string; summary: string; diffStat?: string | undefined }
        | undefined;
      /** System notices (drift/cache) for the active session — docked to the composer
       *  as one quiet indicator line, never sent to the agent. */
      banners: ChatNotice[];
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
      /** Per-model catalog rows (context window/pricing/modalities) — the picker's
       *  hover card resolves any hovered model's row from this. Empty while the
       *  read is loading/failed (the surfaces degrade to their honest unknowns). */
      modelMetadata: ModelMetadata[];
      /** The ACTIVE model's row — the context ring's window; absent ⇒ unknown. */
      activeModelMetadata?: ModelMetadata | undefined;
      /** The active session's last settled usage (the daemon's `usage` push). */
      ringUsage?: SessionUsage | undefined;
      /** The attach control's capability matrix for the active model/backend. */
      attach: AttachControlVm;
      onRespond: RespondFn;
      /** F2: the active session's CONFIGURED permission mode (what was picked/the
       *  agent's default) — undefined session ⇒ the system floor `manual`. */
      mode: PermissionMode;
      /** F2: the mode actually enforced right now — differs from `mode` only when
       *  the active backend has no approval seam (SC-1: never claim an enforcement
       *  the backend can't deliver). The chip renders off THIS, not `mode`. */
      effectiveMode: PermissionMode;
      /** F2: present only when `effectiveMode !== mode` — the honest reason why. */
      modeDegraded?: string | undefined;
      /** F2: live-switch the active session's permission mode. No-op with no active
       *  session. */
      onSetMode: (mode: PermissionMode) => void;
      /** The invocable library skills the composer's slash popover offers; absent ⇒
       *  the library read hasn't settled (the popover states that, never "empty"). */
      skills?: InvocableSkill[] | undefined;
      /** Send, with any staged attachments and explicit skill invocations riding the
       *  same governed send. */
      onSend: (
        text: string,
        attachments?: readonly Attachment[],
        invokeSkills?: readonly string[],
      ) => void;
      /** The Stop/Esc affordance — cooperatively interrupts the active session's running
       *  turn (a user stop, never a governance block; unpressed, nothing
       *  changes). A no-op with no active session (Composer only surfaces Stop while
       *  running, which implies one). */
      onInterrupt: () => void;
      /** Steer: reach the running turn at its next step with a message, discarding nothing
       *  (the composer's Enter/Interrupt default while running). A no-op with no active session. */
      onSteer: (text: string) => void;
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
      /** Jump to another session's own tab/thread (a subagent card's affordance) —
       *  `state.actions.selectSession`, stable identity for the memoized rows. */
      onOpenSession: (sessionId: string) => void;
      toggleRaw: () => void;
      /** The active session id, if any — drives the composer's disabled/hint state
       *  (no session means nothing to send a message into). Session switching itself
       *  lives in the shell now (title-bar tabs + the ⌕ browser) — this vm carries only
       *  the transcript/composer concern. */
      activeSessionId?: string | undefined;
      /** The active session's agent name — feeds the empty state's "`{agent}` is
       *  ready" line. Undefined with no active session/agent. */
      agentName?: string | undefined;
      /** Interim status floor — `running` while a send is in flight, cleared on the next
       *  appended turn. The full 6-state `status` Push replaces this later. */
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
      if (f.role === 'system') {
        // A coa-authored notice (a child session's ending, e.g.) — never the person's
        // voice and never the agent's own claim, so it renders as the same quiet
        // system line as a user interrupt: no chat bubble, no role, no gutter — a
        // system fact can't read as something the model said.
        return { id: f.id, kind: 'note', text: f.text };
      }
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
      // a chat bubble (the user didn't type it) and never an error tone (advisory).
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
      return {
        id: f.id,
        role: f.role,
        kind: 'error',
        message: f.message,
        origin: f.origin,
        depth: f.depth,
      };
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
    // The three subagent announcement cards pass through field-for-field; the agent
    // identity color + resolved display labels are ui-state overlays layered on in
    // `selectChatVm` (they read the agents/sessions lists), same as `resolved` on
    // approvals — never baked into the cached base frame.
    case 'subagent-spawn':
      return {
        id: f.id,
        kind: 'subagent-spawn',
        childSessionId: f.childSessionId,
        childWorktree: f.childWorktree,
        agentRef: f.agentRef,
        description: f.description,
        isolate: f.isolate,
        depth: f.depth,
      };
    case 'subagent-completion':
      return {
        id: f.id,
        kind: 'subagent-completion',
        childSessionId: f.childSessionId,
        childWorktree: f.childWorktree,
        agentRef: f.agentRef,
        reason: f.reason,
        detail: f.detail,
        result: f.result,
        depth: f.depth,
      };
    case 'subagent-message':
      return {
        id: f.id,
        kind: 'subagent-message',
        messageId: f.messageId,
        threadId: f.threadId,
        replyTo: f.replyTo,
        from: f.from,
        to: f.to,
        direction: f.direction,
        body: f.body,
        depth: f.depth,
      };
  }
}

/** The verbatim (unfiltered-loop) projection of one frame. Mock stand-in for the
 *  turn store's raw bytes; rendered byte-faithfully via the Code block (byte-faithful by contract). */
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
    case 'subagent-spawn':
      return `> control: subagent spawn ${f.agentRef} (${f.childSessionId}) ${f.description}`;
    case 'subagent-completion':
      return `> control: subagent ${f.reason} ${f.agentRef} (${f.childSessionId})${f.result !== undefined ? ` ${f.result}` : ''}`;
    case 'subagent-message':
      return `> control: message ${f.direction} ${f.from} -> ${f.to} ${f.body}`;
  }
}

/** A steer pinned at the transcript bottom while it's in flight (a steer is recorded only when the model receives it). `seenAtSend`
 *  is a COUNT, not a position: how many real `you` text frames already had this pin's exact
 *  text at the moment it was sent. The reconciliation effect clears a pin once the live count
 *  for its text has grown past that baseline — so a same-text turn already in the session's
 *  history before the steer existed can never clear it (it's inside the baseline, not past
 *  it). A count survives a WHOLESALE frame-array replacement unscathed, unlike an array
 *  index would: `console.ts`'s `openSession` (reached by ordinary tab switching, keyboard
 *  tab-cycling, and the command palette — none of which check run status) replaces a
 *  session's frames outright on a mid-run reload, and the reloaded array replays the SAME
 *  persisted history, so the count for still-undelivered text is unchanged by it. `id` is a
 *  monotonic counter (not the pin's position in the array) so a row keeps its own identity —
 *  and its own DOM node — when an earlier pin clears out from under it. */
type PendingSteer = { id: number; text: string; seenAtSend: number };

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
 *  `coa raw` omits it (raw is the verbatim, unfiltered projection). Exported for
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
  const ordered = notes
    .map((n, i) => ({ ...n, index: i }))
    .sort((a, b) => b.afterCount - a.afterCount);
  for (const note of ordered) {
    const at = Math.min(Math.max(note.afterCount, 0), result.length);
    result.splice(at, 0, { id: `note:${sessionId}:${note.index}`, kind: 'note', text: note.text });
  }
  return result;
}

/** Pure: projects the polled turn stream + agent/session state into the chat vm.
 *  In raw mode every frame becomes its verbatim line (raw is the verbatim, unfiltered projection); "switched model" notes are
 *  a console-local synthetic frame (never sent to the agent) interleaved only in
 *  governed mode — raw stays the verbatim, unfiltered projection. */
export function selectChatVm(
  state: ConsoleState,
  nowIso = new Date().toISOString(),
  invocableSkills?: InvocableSkill[],
): ChatVm {
  const r = state.data.turns;
  if (r.status !== 'ok') return r;
  const agents = state.data.agents.status === 'ok' ? state.data.agents.value : [];
  const sessions = state.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const { rawMode, resolvedApprovals, activeSessionId, modeBySession, pendingApprovalsBySession } =
    state.ui;
  // F2: the LIVE ask queue (real daemon `approval` pushes / the `sessionMode` reattach
  // read) — the actual F2 ask/response round trip, oldest-first (FIFO: the
  // longest-waiting request is what's blocking the session). Distinct from, and takes
  // priority over, the transcript-frame-derived `pendingApproval` below (dev/test data
  // only — the wire never emits an `approval`-kind turn frame in production).
  const liveApproval =
    rawMode || activeSessionId === undefined
      ? undefined
      : (pendingApprovalsBySession[activeSessionId] ?? [])[0];
  // Identity/label lookups for the subagent-card overlays below: the agent's
  // identity color keys off the frame's own agentRef; a message's from/to session
  // ids resolve to their session titles (the raw id is the honest fallback).
  const agentByRef = new Map(agents.map((a) => [a.ref, a] as const));
  const sessionById = new Map(sessions.map((s) => [s.id, s] as const));
  const messageColor = (sessionId: string): string | undefined => {
    const ref = sessionById.get(sessionId)?.agentRef;
    return ref !== undefined ? agentByRef.get(ref)?.color : undefined;
  };
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
    // The subagent cards' identity color + display labels read the live agents/
    // sessions lists, so they are layered on fresh too (same rationale as the
    // approval overlay; these frames are rare, so the re-render cost is nil).
    if (base.kind === 'subagent-spawn' || base.kind === 'subagent-completion') {
      const color = agentByRef.get(base.agentRef)?.color;
      return color !== undefined ? { ...base, color } : base;
    }
    if (base.kind === 'subagent-message') {
      const color = messageColor(base.from);
      const fromLabel = sessionById.get(base.from)?.title;
      const toLabel = sessionById.get(base.to)?.title;
      if (color === undefined && fromLabel === undefined && toLabel === undefined) return base;
      return {
        ...base,
        ...(color !== undefined ? { color } : {}),
        ...(fromLabel !== undefined ? { fromLabel } : {}),
        ...(toLabel !== undefined ? { toLabel } : {}),
      };
    }
    return base;
  });
  // The pending approval — the newest governed approval frame still unresolved — is
  // lifted out of the transcript and docked to the composer instead (it blocks the
  // input, so it belongs at the input). Raw mode stays the untouched, verbatim
  // projection: an approval never surfaces there at all.
  const pendingApproval = rawMode
    ? undefined
    : [...governedFrames]
        .reverse()
        .find(
          (f): f is Extract<TranscriptFrame, { kind: 'approval' }> =>
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
  // A session with no turns yet has no warm cache that could have gone cold, so the
  // idle-staleness reason is gated on this (the model-changed reason is not).
  const hasRun = r.value.length > 0;
  const banners = computeChatBanners({
    hasRun,
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
    ...(activeSession?.promptConfig !== undefined
      ? { frozenConfig: activeSession.promptConfig }
      : {}),
    agentConfig: {
      ...(activeAgent?.roles !== undefined ? { roles: activeAgent.roles } : {}),
      ...(activeAgent?.packageIds !== undefined ? { packageIds: activeAgent.packageIds } : {}),
      ...(activeAgent?.exclude !== undefined ? { exclude: activeAgent.exclude } : {}),
      // The skill slice a send would compile: configured skills narrowed to the ones
      // the effective library still serves (their disappearance IS drift — the daemon
      // excludes them from the frozen selection the same way).
      skills: resolvableSkillSelection(activeAgent?.skills, invocableSkills),
    },
    ...(activeSessionId !== undefined && state.ui.dismissedDrift[activeSessionId] !== undefined
      ? { dismissedDriftKey: state.ui.dismissedDrift[activeSessionId] }
      : {}),
    ...(activeSessionId !== undefined && state.ui.dismissedCache[activeSessionId] !== undefined
      ? { dismissedCacheKey: state.ui.dismissedCache[activeSessionId] }
      : {}),
    now: nowIso,
  });
  // The model the next turn will run on: a deliberate in-chat override, else the
  // session's pin, else the agent's default.
  const currentModelId = override?.model ?? activeSession?.model ?? activeAgent?.model;
  const currentModel = models.find((m) => m.id === currentModelId);
  const effortOpts = effortOptions(currentModel);
  // The per-model info surfaces: the ACTIVE model's catalog row drives the context
  // ring's window and the attach gate; the full entry list feeds the picker's hover
  // card. The provider resolves the same way the send itself does — the descriptor's
  // own tag first, then the override/pin/agent chain, then the claude default.
  const metadataEntries =
    state.data.modelMetadata.status === 'ok' ? state.data.modelMetadata.value : [];
  const activeProvider =
    currentModel?.provider ??
    override?.provider ??
    activeSession?.provider ??
    activeAgent?.provider;
  const activeModelMetadata = findModelMetadata(metadataEntries, activeProvider, currentModelId);
  const attach = attachControlState(activeModelMetadata, {
    backendCarriesAttachments: providerCarriesAttachments(activeProvider),
  });
  const ringUsage =
    activeSessionId !== undefined ? state.ui.usageBySession[activeSessionId] : undefined;
  const effortVal = reasoningValue(
    override?.reasoning ?? activeSession?.reasoning ?? activeAgent?.reasoning,
  );
  const active = activeSessionId ? state.ui.runStatus[activeSessionId] : undefined;
  // F2: the active session's permission-mode reflection. Undefined ⇒ not yet
  // hydrated (a fresh mount before its `sessionMode` read/first `mode` push lands)
  // — falls back to the active agent's configured default (the system floor,
  // `manual`, when the agent has none), mirroring the daemon's own resolution so
  // the chip never shows a value it will immediately have to correct itself.
  const modeState = activeSessionId !== undefined ? modeBySession[activeSessionId] : undefined;
  const fallbackMode: PermissionMode = activeAgent?.defaultMode ?? 'manual';
  const mode = modeState?.mode ?? fallbackMode;
  const effectiveMode = modeState?.effectiveMode ?? fallbackMode;
  return {
    status: 'ready',
    rawMode,
    frames,
    // The LIVE ask (a real daemon push) always wins over the transcript-frame-derived
    // one — the latter is dev/test data only (see `liveApproval`'s own note above).
    ...(liveApproval !== undefined
      ? {
          approval: {
            id: liveApproval.requestId,
            tool: liveApproval.tool,
            summary: liveApproval.summary,
          },
        }
      : pendingApproval !== undefined
        ? {
            approval: {
              id: pendingApproval.requestId,
              tool: pendingApproval.tool,
              summary: pendingApproval.summary,
              ...(pendingApproval.diffStat !== undefined
                ? { diffStat: pendingApproval.diffStat }
                : {}),
            },
          }
        : {}),
    mode,
    effectiveMode,
    ...(modeState?.degraded !== undefined ? { modeDegraded: modeState.degraded } : {}),
    onSetMode: (next) => {
      if (activeSessionId !== undefined) state.actions.setPermissionMode(activeSessionId, next);
    },
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
    modelMetadata: metadataEntries,
    ...(activeModelMetadata !== undefined ? { activeModelMetadata } : {}),
    ...(ringUsage !== undefined ? { ringUsage } : {}),
    attach,
    ...(invocableSkills !== undefined ? { skills: invocableSkills } : {}),
    onRespond: state.actions.respondApproval,
    onSend: state.actions.sendMessage,
    onInterrupt: () => {
      if (activeSessionId !== undefined) state.actions.interruptSession(activeSessionId);
    },
    onSteer: (text: string) => {
      if (activeSessionId !== undefined) state.actions.steerSession(activeSessionId, text);
    },
    openPath: state.actions.openPath,
    openExternal: state.actions.openExternal,
    onOpenSession: state.actions.selectSession,
    toggleRaw: state.actions.toggleRaw,
    activeSessionId,
    ...(activeAgent?.name !== undefined ? { agentName: activeAgent.name } : {}),
    sessionStatus: active ? 'running' : 'idle',
    ...(active ? { runningSince: active.since } : {}),
    sendNonce: activeSessionId !== undefined ? (state.ui.sendNonce[activeSessionId] ?? 0) : 0,
  };
}

/** A fresh session: teach the register in three quiet lines — who is ready, on
 *  what, and how to speak. Sits above center so the composer's floor doesn't
 *  crowd it. Ported from the proto's `EmptyConversation` (apps/workbench-proto/
 *  src/chat/Transcript.tsx). */
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
        {model} · {effort}
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

  // Queued follow-up messages (the composer's Queue action while a turn runs), held per active
  // session and released one at a time (FIFO) as a normal send when that session's turn ends. Kept
  // console-side so they stay visibly PINNED above the composer until they run; a steer skips the
  // queue entirely and reaches the running turn at its next step (via `onSteer`).
  const [queuedBySession, setQueuedBySession] = useState<Record<string, string[]>>({});
  // A sent steer reaches the agent at its next round trip, seconds later, and the daemon
  // writes its transcript line only THEN (a steer is recorded only when the model receives it). Held here so the sender sees their
  // own message immediately, rendered last because it has not happened yet.
  const [pendingSteerBySession, setPendingSteerBySession] = useState<
    Record<string, PendingSteer[]>
  >({});
  // Monotonic id source for pins (see `PendingSteer`) — module-stable per component instance,
  // never reset, so two pins never collide even after earlier ones have cleared.
  const pendingIdRef = useRef(0);
  const vmRef = useRef(vm);
  vmRef.current = vm;
  const activeId = vm.status === 'ready' ? vm.activeSessionId : undefined;
  const running = vm.status === 'ready' && vm.sessionStatus === 'running';
  const activeQueue = activeId !== undefined ? (queuedBySession[activeId] ?? []) : [];
  const activePending = activeId !== undefined ? (pendingSteerBySession[activeId] ?? []) : [];

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
  // queue (a steer skips the queue entirely — it routes straight to `vm.onSteer`).
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

  // Steer reaches the running turn directly (via `vm.onSteer`), skipping the queue
  // entirely — but it still needs a placeholder to hold, since the real transcript line
  // does not exist until the daemon's delivery lands (a steer is recorded only when the model receives it). `seenAtSend` is
  // stamped from how many REAL `you` frames already carry this exact text, not read later —
  // the pin must only ever be satisfied by an occurrence beyond that baseline, never a
  // same-text turn already in the session's history.
  const handleSteer = useCallback((text: string): void => {
    const cur = vmRef.current;
    if (cur.status !== 'ready' || cur.activeSessionId === undefined) return;
    const id = cur.activeSessionId;
    const seenAtSend = cur.frames.filter(
      (f) => f.kind === 'text' && f.role === 'you' && f.text === text,
    ).length;
    const pin: PendingSteer = { id: pendingIdRef.current++, text, seenAtSend };
    setPendingSteerBySession((m) => ({ ...m, [id]: [...(m[id] ?? []), pin] }));
    cur.onSteer(text);
  }, []);

  const activeRealFrames = vm.status === 'ready' ? vm.frames : [];

  // Drop a pin when its own line arrives — matched by a COUNT past a baseline, not by
  // membership or by array position. Per distinct text: count how many real `you` frames
  // currently carry it, and walk that text's pins oldest-first, each consuming one
  // occurrence once the running claim pointer has passed both (a) its own `seenAtSend`
  // floor — a same-text turn already in the history before the pin was born can never
  // satisfy it, the original bug — and (b) whatever earlier same-text pins already
  // claimed, so N identical pins whose deliveries land in the SAME transition each get
  // their own occurrence instead of racing to clear on one hit. Text equality is exact —
  // the daemon records a delivery verbatim and bare. Carrying an echoed id instead would
  // put a field on the persisted frame purely to serve the console.
  //
  // A COUNT, not an index, on purpose: a wholesale replacement of a session's frame array
  // is reachable WHILE a turn is still running, not just once idle — `openSession`
  // (console.ts) is called unconditionally by `selectSession`, wired to ordinary tab
  // switching, keyboard tab-cycling, and the command palette, none of which check run
  // status, and its mid-run reload REPLACES the frames array outright. An index-based mark
  // breaks under that (a stale position can miss the real delivery — wedging the pin past
  // this effect entirely, caught only by the idle sweep below — or hit an unrelated frame
  // that merely landed at the same numeric slot). A count survives it: the reload replays
  // the SAME persisted history, so the occurrence count for still-undelivered text is
  // unchanged by the array's identity or length changing underneath it.
  useEffect(() => {
    if (activeId === undefined) return;
    const countsByText = new Map<string, number>();
    for (const f of activeRealFrames) {
      if (f.kind === 'text' && f.role === 'you') {
        countsByText.set(f.text, (countsByText.get(f.text) ?? 0) + 1);
      }
    }
    setPendingSteerBySession((m) => {
      const cur = m[activeId] ?? [];
      if (cur.length === 0) return m;
      const claimedByText = new Map<string, number>();
      const kept = cur.filter((pin) => {
        const total = countsByText.get(pin.text) ?? 0;
        const claimed = Math.max(claimedByText.get(pin.text) ?? 0, pin.seenAtSend);
        claimedByText.set(pin.text, claimed < total ? claimed + 1 : claimed);
        return claimed >= total;
      });
      return kept.length === cur.length ? m : { ...m, [activeId]: kept };
    });
  }, [activeRealFrames, activeId]);

  // Belt-and-braces: a turn that ended took every drain point with it, so nothing is still
  // coming. Without this a pin could wedge forever if the text were ever transformed on the
  // way (surfacing must never become a stuck state).
  useEffect(() => {
    if (activeId === undefined || running) return;
    setPendingSteerBySession((m) => (m[activeId]?.length ? { ...m, [activeId]: [] } : m));
  }, [running, activeId]);

  // Keep-alive tab inputs (hooks stay above the states-first early return).
  const tabs = useShell((s) => s.tabs);
  const shellMode = useShell((s) => s.mode);

  // Read the reveal action + active session through refs so the `onOpenPath` handed to
  // the memoized transcript rows keeps a STABLE identity across renders (the vm — hence
  // `vm.openPath`/`vm.activeSessionId` — is rebuilt every render; threading them directly
  // would defeat `MemoRow`'s memoization). The action itself is already stable; the ref
  // just lets one stable closure always see the current session.
  const openPathRef = useRef(vm.status === 'ready' ? vm.openPath : undefined);
  const openUrlRef = useRef(vm.status === 'ready' ? vm.openExternal : undefined);
  const openSessionRef = useRef(vm.status === 'ready' ? vm.onOpenSession : undefined);
  const sessionIdRef = useRef<string | undefined>(undefined);
  openPathRef.current = vm.status === 'ready' ? vm.openPath : undefined;
  openUrlRef.current = vm.status === 'ready' ? vm.openExternal : undefined;
  openSessionRef.current = vm.status === 'ready' ? vm.onOpenSession : undefined;
  sessionIdRef.current = vm.status === 'ready' ? vm.activeSessionId : undefined;

  const onOpenPath = useCallback((path: string, line?: number): void => {
    const open = openPathRef.current;
    if (open === undefined) return;
    void open(path, line, sessionIdRef.current).then((res) => {
      // Advisory: a failed reveal is announced on the shell's one failure surface and
      // nothing about the conversation changes.
      if (!res.ok) reportFailure('open that file', res.reason ?? 'the file could not be opened.');
    });
  }, []);

  // A tool card's web link opens in the default browser (via the openExternal IPC, which
  // validates the scheme). Stable identity (ref pattern) so it threads into the memoized
  // transcript rows without defeating `MemoRow`'s memoization. A failed open toasts (advisory).
  const onOpenUrl = useCallback((url: string): void => {
    const open = openUrlRef.current;
    if (open === undefined) return;
    void open(url).then((res) => {
      if (!res.ok) reportFailure('open that link', res.reason ?? 'the link could not be opened.');
    });
  }, []);

  // A subagent card's jump-to-thread — session switching via the console action.
  // Stable identity (ref pattern, mirrors onOpenPath) for the memoized rows.
  const onOpenSession = useCallback((sessionId: string): void => {
    openSessionRef.current?.(sessionId);
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
      if (entry !== undefined)
        setComposerHeight((prev) => composerMeasure(prev, entry.contentRect.height));
    });
    ro.observe(target);
    composerRoRef.current = ro;
  }, []);

  if (vm.status !== 'ready') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-s1 p-3.5">
        {vm.status === 'loading' && (
          // The loading circle, centered — shown only on a cold cache; warm
          // switches render instantly from `turnsBySession`.
          <div className="flex flex-1 items-center justify-center">
            <Spinner label="Loading conversation" />
          </div>
        )}
        {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      </div>
    );
  }
  const queuedMessages = activeQueue.map((text, i) => ({ id: String(i), text }));
  // Appended after the real frames, never spliced in: a pending steer has not happened
  // yet, so it cannot sit anywhere but last. Governed-path only (mirrors `pendingApproval`
  // being excluded from raw) — a pin is console state, not loop output.
  const framesWithPending: TranscriptFrame[] = [
    ...vm.frames,
    ...(vm.rawMode
      ? []
      : activePending.map((pin) => ({
          // Keyed on the pin's OWN id, not its array position — an earlier pin clearing
          // must not reshuffle a survivor's id (that remounts its row for no reason; see
          // `PendingSteer`).
          id: `pending:${activeId ?? ''}:${pin.id}`,
          role: 'you' as const,
          kind: 'text' as const,
          text: pin.text,
          pending: true,
        }))),
  ];
  // Refresh the keep-alive caches for the active session, then derive which
  // tabs stay mounted: every open tab already visited (cache hit) + the active
  // one. Unvisited tabs mount lazily on their first activation.
  const activeTabId = vm.activeSessionId ?? 'none';
  if (vm.activeSessionId !== undefined) {
    framesBySession.set(vm.activeSessionId, vm.frames);
    nonceBySession.set(vm.activeSessionId, vm.sendNonce);
  }
  const keepAlive = [...new Set([...tabs.filter((t) => framesBySession.has(t)), activeTabId])];
  const currentModelDesc = vm.models.find((m) => m.id === vm.currentModelId);
  const currentModelLabel =
    currentModelDesc !== undefined
      ? modelPickerLabel(currentModelDesc)
      : (vm.currentModelId ?? 'model');
  const currentEffortLabel =
    vm.effortOptions.find((e) => e.value === vm.effortValue)?.label ?? vm.effortValue;
  return (
    <>
      {/* Session-switching chrome (title bar, session switcher, agent rail) is retired here —
          the shell's title-bar tabs + ⌕ browser own switching now (docs/design plan A1). This
          is a plain layout container, not a re-styled Pane — the running/needs-you state now
          lives on the composer's own edge (its status-outline shimmer). */}
      <div className="flex h-full min-h-0 flex-col bg-s1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The transcript fills the pane; the composer floats over its bottom edge
              (below) so the transcript stays visible around/behind it. The transcript's
              own scroll region reserves `composerHeight` of bottom inset so the last row
              clears the floating composer when scrolled fully down.

              PaneOverlayProvider hosts a tool card's Expand overlay CONFINED to this
              transcript box (`absolute inset-0` within its own `relative` container) — so
              expanding a deeply-scrolled row covers the transcript region only, never the
              window, and the floating composer stays over its bottom edge. */}
          <PaneOverlayProvider className="flex-1 bg-s1">
            {/* THE TAB MODEL: every visited open tab keeps its transcript mounted —
                switching is a display swap, not a rebuild (and search mode hides,
                never unmounts). Only a tab's FIRST mount is heavy, and that one
                goes through a transition (DeferredCanvas) so the switch paints
                before the rows do. Hidden tabs render their last-seen frames from
                the module cache; the active tab always renders the live vm. */}
            {keepAlive.map((tid) => {
              const isActive = tid === activeTabId;
              const frames = isActive ? framesWithPending : (framesBySession.get(tid) ?? []);
              return (
                <div key={tid} className={isActive ? 'h-full' : 'hidden'}>
                  {/* Frozen while hidden: live publishes must not re-render
                      background tabs (that cost is the switching slowdown). */}
                  <Freeze frozen={!isActive}>
                    <DeferredCanvas id={tid}>
                      {frames.length === 0 ? (
                        isActive ? (
                          <EmptyConversation
                            agent={vm.agentName ?? 'agent'}
                            model={currentModelLabel}
                            effort={currentEffortLabel}
                          />
                        ) : null
                      ) : (
                        <Transcript
                          frames={frames}
                          // Hidden tabs (and search mode) stand down: keys, the
                          // stick-to-bottom observer, scroll saves. Reactivation
                          // restores the session's remembered scroll place.
                          active={isActive && shellMode === 'work'}
                          // the find chord is rebindable, so the registry names it — not the kit
                          findMatch={matchesFind}
                          onOpenPath={onOpenPath}
                          onOpenUrl={onOpenUrl}
                          onOpenSession={onOpenSession}
                          label="Conversation"
                          busy={isActive && vm.sessionStatus === 'running'}
                          busySince={isActive ? vm.runningSince : undefined}
                          jumpNonce={isActive ? vm.sendNonce : nonceBySession.get(tid)}
                          bottomInset={composerHeight}
                          scrollKey={tid}
                        />
                      )}
                    </DeferredCanvas>
                  </Freeze>
                </div>
              );
            })}
          </PaneOverlayProvider>
          {/* A plain, non-positioning wrapper — the composer self-positions
              (`absolute bottom-4 left-1/2 …`) against this pane's own `relative`
              container above, not against this wrapper. It exists only to host
              the height-measuring ResizeObserver (see `composerRef`) and to
              give the composer's focused Escape a place to fall through to the
              Stop affordance (a user stop, never a governance block). */}
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
              notices={vm.banners}
              onNoticeAction={vm.onBannerAction}
              running={vm.sessionStatus === 'running'}
              disabled={vm.activeSessionId === undefined}
              activeSessionId={vm.activeSessionId}
              queued={queuedMessages}
              approval={vm.approval}
              mode={vm.mode}
              effectiveMode={vm.effectiveMode}
              modeDegraded={vm.modeDegraded}
              onSetMode={vm.onSetMode}
              models={vm.models}
              currentModelId={vm.currentModelId}
              onPickModel={vm.onPickModel}
              effortOptions={vm.effortOptions}
              effortValue={vm.effortValue}
              onPickEffort={vm.onPickEffort}
              modelMetadata={vm.modelMetadata}
              activeModelMetadata={vm.activeModelMetadata}
              ringUsage={vm.ringUsage}
              attach={vm.attach}
              skills={vm.skills}
              onSend={vm.onSend}
              onQueue={handleQueue}
              onSteer={handleSteer}
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
    </>
  );
}

/** State-fed surface: computes the vm from console state and renders the chat pane.
 *  Also mounts the library read (idempotent, the auth-store convention): the slash
 *  popover's invocable rows and the drift compare's skill slice both come from it. */
export function ChatSurface({ state }: { state: ConsoleState }): React.JSX.Element {
  const invocable = useLibraryStore((s) => s.invocable);
  useEffect(() => {
    void useLibraryStore
      .getState()
      .hydrate()
      .catch(() => {});
  }, []);
  return <ChatView vm={selectChatVm(state, undefined, invocable)} />;
}

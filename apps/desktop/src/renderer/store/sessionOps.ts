import { reloadToViewFrames, type ModelSelection } from '@coa/console-viewmodel';
import { cacheKey, configKey } from '../panels/banners.js';
import { resolveSelection } from '../panels/selection.js';
import { reportNotice, surfaceWrite } from '../shell/failures.js';
import { settle, type ConsoleBridge } from './bridge.js';
import { agentsValue, useDaemonData } from './data.js';
import { modelSwitchNoteText } from './notices.js';
import {
  beginRun,
  bumpSendNonce,
  clearRunStatus,
  evictSessionState,
  patchSessionList,
  sessionsValue,
  setActiveSession,
  setSessionList,
  useSessions,
} from './sessions.js';
import {
  appendFrames,
  applyReload,
  beginHydration,
  evictTranscript,
  framesOf,
  hydrationFailed,
} from './transcripts.js';
import {
  appendSessionNote,
  clearModelOverride,
  evictUiSession,
  setDismissedCache,
  setDismissedDrift,
  useConsoleUi,
} from './ui.js';

/** The controller-scoped state the session operations share: the injected bridge, which
 *  sessions are attached (subscribed + hydration kicked) on the CURRENT daemon
 *  connection, and the monotonic id source for locally-rendered `you` turns. */
export interface SessionCtx {
  bridge: ConsoleBridge;
  attached: Set<string>;
  youSeq: { n: number };
}

/** Refresh the rail's session list (title/recency) without touching any transcript. */
export async function refreshSessionList(ctx: SessionCtx): Promise<void> {
  const loaded = await settle(() => ctx.bridge.listSessions());
  setSessionList(loaded);
}

/**
 * Make a session's transcript live: subscribe to the daemon session and hydrate the
 * store entry from the durable log, once per daemon connection. A warm, attached
 * session is already authoritative through the push stream, so re-selecting it touches
 * no I/O at all — activation is a pure display swap (the instant-navigation rule).
 * Reload is a cold-hydration/reattach path, never a switch path.
 */
export function ensureMaterialized(ctx: SessionCtx, id: string): void {
  if (ctx.attached.has(id)) return;
  ctx.attached.add(id);
  beginHydration(id);
  // A reattach the daemon REFUSES is the reattach that matters: `subscribed: false`
  // means it holds no live session for this conversation, so nothing can be running and
  // no hydrating status push is coming. Ignoring that answer is what left a session
  // spinning forever after the daemon died mid-turn. The daemon is the authority on
  // liveness in both directions, not just when it says yes.
  //
  // Read the send counter first and only act if it hasn't moved: a send issued while
  // this round trip was in flight is newer news than the answer coming back.
  const sendsAtSubscribe = useSessions.getState().sendNonce[id];
  void ctx.bridge
    .subscribeSession({ id })
    .then((result) => {
      if (result.subscribed) return;
      if (useSessions.getState().sendNonce[id] !== sendsAtSubscribe) return;
      clearRunStatus(id);
    })
    .catch(() => {
      // A failed reattach says nothing about liveness — the daemon being unreachable is
      // already the gate's story, and guessing here would be the same lie inverted.
    });
  void settle(() => ctx.bridge.reloadConversation({ id })).then((loaded) => {
    if (loaded.status === 'ok') {
      applyReload(id, reloadToViewFrames(loaded.value, id));
    } else {
      // Cold opens surface the error; a warm cache keeps showing (hydrationFailed is a
      // no-op there). Either way the next activation retries the hydration.
      hydrationFailed(id, loaded.message);
      ctx.attached.delete(id);
    }
  });
}

/** Open a session: the active id flips SYNCHRONOUSLY — a warm entry renders this same
 *  frame; a cold one shows its loading state while `ensureMaterialized` hydrates it. */
export function activateSession(ctx: SessionCtx, id: string): void {
  setActiveSession(id);
  ensureMaterialized(ctx, id);
}

/** Clear the active selection when no session remains. */
export function clearActiveSession(): void {
  setActiveSession(undefined);
}

export function newSession(ctx: SessionCtx, agentRef: string): void {
  void (async () => {
    const created = await surfaceWrite(
      'start that conversation',
      ctx.bridge.newSession({ agentRef }),
    );
    if (created === undefined) return;
    await refreshSessionList(ctx);
    activateSession(ctx, created.id);
  })();
}

export function deleteSession(ctx: SessionCtx, id: string): void {
  void (async () => {
    const deleted = await surfaceWrite(
      'delete that conversation',
      ctx.bridge.deleteSession({ id }),
    );
    // Nothing was removed and the user has been told — the rail still shows the truth.
    if (deleted === undefined) return;
    const wasActive = useSessions.getState().activeSessionId === id;
    // The one transcript eviction point: the session is gone, so every per-session
    // record goes with it (frames, run claims, overrides, dismissals, notes).
    ctx.attached.delete(id);
    evictTranscript(id);
    evictSessionState(id);
    evictUiSession(id);
    await refreshSessionList(ctx);
    if (wasActive) {
      const newest = sessionsValue()[0];
      if (newest) activateSession(ctx, newest.id);
      else clearActiveSession();
    }
  })();
}

export function sendMessage(ctx: SessionCtx, text: string): void {
  const body = text.trim();
  const id = useSessions.getState().activeSessionId;
  if (body === '' || id === undefined) return;
  ctx.youSeq.n += 1;
  const youSeq = ctx.youSeq.n;
  beginRun(id);
  bumpSendNonce(id);
  const activeSession = sessionsValue().find((s) => s.id === id);
  const agent = activeSession
    ? agentsValue().find((a) => a.ref === activeSession.agentRef)
    : undefined;
  // Resolve the selection as a COHERENT UNIT: the override is a partial patch over
  // the resolved selection (session pin or agent config) — not a whole replacement.
  // onPickEffort sends only {reasoning}, so treating the override as the full
  // model selection silently drops the provider + model and falls back to the default
  // backend. Merging the override on top of the resolved selection avoids that.
  const resolved = resolveSelection(activeSession, agent);
  const override = useConsoleUi.getState().modelOverride[id];
  const model: ModelSelection = override ? { ...resolved, ...override } : resolved;
  // A model/effort override applied on this send drops a console-local "switched
  // model" note into the transcript — BEFORE the user turn, so it reads as the
  // context the send ran under. Never sent to the agent (a synthetic UI frame, not a
  // wire TurnFrame) and omitted in `coa raw` (raw is the verbatim loop only).
  if (override !== undefined) {
    const modelsRemote = useDaemonData.getState().models;
    const models = modelsRemote.status === 'ok' ? modelsRemote.value : [];
    const afterCount = framesOf(id)?.length ?? 0;
    appendSessionNote(id, { afterCount, text: modelSwitchNoteText(override, models) });
  }
  appendFrames(id, [{ id: `you:${youSeq}`, role: 'you', kind: 'text', text: body }]);
  // The pending pick is being applied now: clear the override and optimistically pin
  // it locally, so the predictive cache banner clears on send (the daemon persists the
  // same pin, which a later refresh confirms).
  if (override !== undefined) {
    patchSessionList((sessions) =>
      sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              updatedAt: new Date().toISOString(),
              ...(override.provider !== undefined ? { provider: override.provider } : {}),
              ...(override.model !== undefined ? { model: override.model } : {}),
              ...(override.reasoning !== undefined ? { reasoning: override.reasoning } : {}),
            }
          : s,
      ),
    );
    clearModelOverride(id);
  }
  void ctx.bridge
    .startSession({
      input: body,
      conversationId: id,
      // The registry roles the agent is assembled as; absent/empty ⇒ the permissive floor.
      ...(agent?.roles && agent.roles.length > 0 ? { roles: agent.roles } : {}),
      // Assembly selection (only applied when a role is set — see the resolver's floor).
      ...(agent?.packageIds && agent.packageIds.length > 0 ? { packageIds: agent.packageIds } : {}),
      ...(agent?.exclude && agent.exclude.length > 0 ? { exclude: agent.exclude } : {}),
      ...(Object.keys(model).length > 0 ? { model } : {}),
    })
    // The first send auto-titles the session server-side; reflect it in the rail.
    .then(() => refreshSessionList(ctx))
    .catch((e: unknown) => {
      // A failed dispatch never streams a turn back — clear the pill here so it
      // doesn't run forever.
      clearRunStatus(id);
      appendFrames(id, [
        {
          id: `err:${youSeq}`,
          role: 'agent',
          kind: 'text',
          text: `⚠ ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    });
}

/** The Stop/Esc affordance — a user-initiated stop (never a governance block).
 *  On a real stop the running pill clears from the daemon's own `'interrupted'` status
 *  Push, not from this call's result.
 *
 *  `interrupted: false` is the case that used to disappear: the daemon has no running
 *  turn to stop, so no push is coming and Stop reads as a dead button. That answer is
 *  authoritative — nothing is running — so the pill clears here and the console says
 *  what happened rather than leaving the user pressing a control that does nothing. */
export function interruptSession(ctx: SessionCtx, sessionId: string): void {
  void surfaceWrite('stop that turn', ctx.bridge.interruptSession({ id: sessionId })).then(
    (result) => {
      if (result === undefined || result.interrupted) return;
      clearRunStatus(sessionId);
      reportNotice('Nothing to stop', 'that turn had already finished.');
    },
  );
}

/** Steer: reach the running turn at its next step, discarding nothing (a user redirect,
 *  never a block). The daemon writes the transcript line when the model actually
 *  RECEIVES the text, which is seconds later — the panel pins the message meanwhile.
 *
 *  `steered: false` is the case that used to disappear: the daemon has no live turn to
 *  reach, so the text was DROPPED and no frame is ever coming for it. The console
 *  says the message did not land instead of letting the pin silently sweep away. */
export function steerSession(ctx: SessionCtx, sessionId: string, text: string): void {
  const body = text.trim();
  if (body === '') return;
  void surfaceWrite('send that steer', ctx.bridge.steerSession({ id: sessionId, text: body })).then(
    (result) => {
      if (result === undefined || result.steered) return;
      reportNotice('Nothing to steer', 'that turn is no longer running, so nothing received it.');
    },
  );
}

// The drift/cache notices are DERIVED live in the chat vm (predictive: computed from
// the pending pick + the running prompt's config the daemon reports), so the console
// only holds the bits of notice STATE the derivation reads: the model override and the
// per-session drift and cache dismissals. A notice action mutates that state.
export function onBannerAction(
  ctx: SessionCtx,
  sessionId: string,
  bannerId: string,
  actionId: string,
): void {
  if (bannerId === 'cache' && actionId === 'dismiss') {
    // Nothing to fix — an idle cache cannot be un-cooled — so dismissal is the only
    // control, and it has to remember WHAT it dismissed or the derivation re-raises the
    // notice on the very next render.
    const session = sessionsValue().find((s) => s.id === sessionId);
    const override = useConsoleUi.getState().modelOverride[sessionId];
    const key = cacheKey({
      ...(override !== undefined ? { override } : {}),
      ...(session !== undefined
        ? {
            pinned: {
              ...(session.provider !== undefined ? { provider: session.provider } : {}),
              ...(session.model !== undefined ? { model: session.model } : {}),
            },
          }
        : {}),
    });
    setDismissedCache(sessionId, key);
    return;
  }
  if (bannerId === 'drift' && actionId === 'recompile') {
    // Drop the frozen prompt server-side, then refresh so the session's promptConfig
    // clears — the drift derivation then reads "no running prompt" ⇒ no banner.
    //
    // The suppression is dropped only AFTER the daemon confirms. Clearing it up front
    // made a failed recompile invisible in the worst way: the frozen prompt was still
    // there, so the derivation re-raised the same banner, and the button read as a
    // control that did nothing at all. Now a refusal says so and the banner is honestly
    // still describing a prompt that never recompiled.
    void surfaceWrite('recompile that prompt', ctx.bridge.recompilePrompt({ sessionId })).then(
      async (result) => {
        if (result === undefined) return;
        if (!result.recompiled) {
          reportNotice('Nothing to recompile', 'this conversation has no compiled prompt to drop.');
          return;
        }
        setDismissedDrift(sessionId, undefined);
        await refreshSessionList(ctx);
      },
    );
    return;
  }
  if (bannerId === 'drift' && actionId === 'dismiss') {
    // Suppress the drift banner for the config it currently reflects; a further config
    // change is a new key, so it re-shows. Keyed off the active agent's config.
    const session = sessionsValue().find((s) => s.id === sessionId);
    const agent = session ? agentsValue().find((a) => a.ref === session.agentRef) : undefined;
    const key = configKey({
      roles: agent?.roles,
      packageIds: agent?.packageIds,
      exclude: agent?.exclude,
    });
    setDismissedDrift(sessionId, key);
  }
}

/** Whether a session's own backend is claude — a session's PIN wins (it already ran
 *  there); an unpinned session falls back to its agent's provider; no provider recorded
 *  anywhere ⇒ the default backend, which is claude. Used to scope the live auth-failure
 *  signal so a non-claude session's auth error never lights the claude login badge. */
export function sessionUsesClaude(sessionId: string): boolean {
  const session = sessionsValue().find((s) => s.id === sessionId);
  const agent = session ? agentsValue().find((a) => a.ref === session.agentRef) : undefined;
  const provider = session?.provider ?? agent?.provider;
  return provider === undefined || provider === 'claude';
}

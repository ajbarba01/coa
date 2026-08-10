import type { BackendMessage, CapabilityFrame, NeutralConfig } from '@coa/shared';
import type { ConversationStore } from './conversation-store.js';
import type { PersistIn, SeqBox } from './frame-recorder.js';
import type { LiveSession, TurnRequest } from './live-session.js';
import { planMemory, type MemoryPlan } from './memory-plan.js';
import { renderInvokedSkill } from './skill-invocation.js';
import {
  configHashOf,
  frozenModelMatches,
  modelPromptKeyOf,
  promptVersionOf,
  type FrozenCompilation,
  type ModelPromptKey,
  type PromptConfig,
} from './prompt-freeze.js';

/**
 * Everything that has to happen to a conversation's durable record BEFORE and AROUND a
 * turn, in one place, so both drive strategies get exactly the same treatment: mint the
 * conversation if it is new, decide how the model regains its memory, reuse or recompile
 * the frozen prompt, pin the effective model selection, and append the user's prompt.
 *
 * It is split in two because the two halves run at different moments. The prelude
 * ({@link prepareTurnPersistence}) reads and writes the store up front and returns the facts
 * it derived; {@link buildPersistenceHooks} turns those facts into the callbacks the session
 * call carries, which fire later, from inside the run.
 */

/** A session's rail label from its opening prompt (single line, bounded) — the auto-title
 *  a person never has to write. */
export function deriveTitle(input: string): string {
  const oneLine = input.replace(/\s+/g, ' ').trim();
  if (oneLine === '') return 'new session';
  return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}…`;
}

/** The per-turn facts the persistence prelude computes and the session-call hooks
 *  consume — shared verbatim by the per-turn and held-open establishment paths. */
export interface PreparedTurn {
  persistIn: PersistIn | undefined;
  role: string;
  provider: string;
  model: string | undefined;
  modelKey: ModelPromptKey;
  currentConfig: PromptConfig;
  plan: MemoryPlan;
  frozen: FrozenCompilation | undefined;
  promptVersion: string | undefined;
}

/** The subset of a session-creation request that carries memory + persistence — spread
 *  into the call by both drive strategies (built by {@link buildPersistenceHooks}). */
export interface PersistenceHooks {
  resume?: string;
  history?: readonly BackendMessage[];
  deliverHistoryAsPreamble?: true;
  frozen?: { neutral: NeutralConfig; frame: CapabilityFrame };
  onCompile?: (compiled: { neutral: NeutralConfig; frame: CapabilityFrame }) => void;
  onBackendSession?: (id: string) => void;
}

/**
 * The per-turn persistence prelude shared by BOTH drive strategies: create the
 * conversation if new, decide the memory hand-off (resume/replay/preamble), pin the
 * effective selection, auto-title, and append this turn's user prompt — advancing
 * `seqBox` past it. The `seqBox` is a shared cursor: for a per-turn turn it is fresh;
 * for the held-open strategy it is the query-scoped cursor the long-lived recorder keeps
 * incrementing, so a later turn's user prompt never collides with the prior turn's
 * streamed frames. Ephemeral (no-store) turns carry no memory and start at `seq` 0.
 */
export function prepareTurnPersistence(
  turn: TurnRequest,
  session: LiveSession,
  role: string,
  persistentStore: ConversationStore | undefined,
  seqBox: SeqBox,
): PreparedTurn {
  const persistIn: PersistIn | undefined =
    persistentStore !== undefined ? { convId: session.id, store: persistentStore } : undefined;
  const provider = turn.model?.provider ?? 'claude';
  const model = turn.model?.model;
  const modelKey = modelPromptKeyOf(turn.model);
  const currentConfig: PromptConfig = {
    role,
    ...(turn.roles !== undefined ? { roles: [...turn.roles].sort() } : {}),
    ...(turn.packageIds !== undefined ? { packageIds: turn.packageIds } : {}),
    ...(turn.exclude !== undefined ? { exclude: turn.exclude } : {}),
    // The RESOLVED skill selection — what actually shaped (or would shape) the
    // prompt, so a skill appearing/vanishing in the library reads as drift.
    ...(turn.skillSelection !== undefined ? { skills: turn.skillSelection } : {}),
  };
  let plan: MemoryPlan = { history: [], deliverHistoryAsPreamble: false };
  let frozen: FrozenCompilation | undefined;
  let promptVersion: string | undefined;
  seqBox.value = 0;

  if (persistIn !== undefined) {
    const { convId: id, store: cs } = persistIn;
    if (cs.getMeta(id) === undefined) {
      cs.create({
        // Known mock coupling: `agentRef` stands in for a real agent reference;
        // prefer the first selected role when present.
        id,
        agentRef: turn.roles?.[0] ?? role,
        title: deriveTitle(turn.input),
        scope: turn.scope ?? '',
      });
    }
    const { turns: prior } = cs.reload(id);
    // `skipped` is what the fold could not read. It has to reach the plan: this transcript
    // IS the model's memory on resume, and a fragment is indistinguishable from the whole
    // record once the count is dropped.
    const { messages: transcript, skipped } = cs.loadBackendMessages(id);
    const storedFrozen = cs.getCompilation(id);
    // Reuse the frozen prompt only when the send's model matches the one it was
    // compiled with; a model switch drops it here (undefined ⇒ recompile), so the
    // `## Model` line is re-authored — silently, WITHOUT touching drift.
    frozen =
      storedFrozen !== undefined && frozenModelMatches(storedFrozen, modelKey)
        ? storedFrozen
        : undefined;
    promptVersion = frozen?.promptVersion;
    const priorMeta = cs.getMeta(id);
    seqBox.value = prior.length === 0 ? 0 : prior[prior.length - 1]!.seq + 1;
    if (prior.length === 0) {
      const title = cs.getMeta(id)?.title;
      if (title === undefined || title === '' || title === 'new session') {
        cs.rename(id, deriveTitle(turn.input));
      }
    }
    // Decide the memory hand-off BEFORE re-pinning the selection (the plan reads the
    // PRIOR turn's resume stamp), then pin what this turn runs on so a restart/next
    // turn routes to the same backend the memory lives in.
    plan = planMemory({
      provider,
      ...(model !== undefined ? { model } : {}),
      ...(promptVersion !== undefined ? { promptVersion } : {}),
      meta: priorMeta,
      transcript,
      skippedEvents: skipped,
    });
    cs.setSelection(id, {
      provider,
      ...(model !== undefined ? { model } : {}),
      ...(turn.model?.reasoning !== undefined ? { reasoning: turn.model.reasoning } : {}),
    });
    // Persist (but never push — the console already showed it optimistically) the user
    // turn — preceded by any invoked skill's payload as its OWN `system` frame, so the
    // durable log carries exactly what the model was handed (skill block above the
    // user's words) while the user's raw text stays the canonical user turn (titles,
    // pins, and the console's optimistic echo all read `input` unaugmented).
    appendInvokedSkills(turn, persistIn, seqBox);
    cs.append(id, [{ seq: seqBox.value, frame: { t: 'text', text: turn.input, role: 'user' } }]);
    seqBox.value += 1;
  }

  return {
    persistIn,
    role,
    provider,
    model,
    modelKey,
    currentConfig,
    plan,
    frozen,
    promptVersion,
  };
}

/**
 * Persist a turn's invoked-skill payloads (slash invocation) as `system` text
 * frames ABOVE the turn's user frame — the same order the composed model input
 * uses (skill-invocation.ts), so replay and live delivery agree. Shared by the
 * per-turn/establish prelude ({@link prepareTurnPersistence}) and the held-open
 * continue path, which appends its own user frame.
 */
export function appendInvokedSkills(
  turn: TurnRequest,
  persistIn: PersistIn | undefined,
  seqBox: SeqBox,
): void {
  if (persistIn === undefined) return;
  const invoked = turn.invokedSkills ?? [];
  if (invoked.length === 0) return;
  persistIn.store.append(
    persistIn.convId,
    invoked.map((skill) => ({
      seq: seqBox.value++,
      frame: { t: 'text' as const, text: renderInvokedSkill(skill), role: 'system' as const },
    })),
  );
}

/**
 * Build the session call's persistence hooks from a prepared turn — the memory
 * hand-off (`resume`/`history`/preamble), the frozen-prompt reuse or fresh-compile
 * capture, and the backend-session/transcript persistence. Owns the mutable
 * `promptVersion` the compile capture writes and the session/transcript stamps read.
 */
export function buildPersistenceHooks(prep: PreparedTurn): PersistenceHooks {
  const { persistIn, plan, frozen, currentConfig, modelKey, provider, model } = prep;
  let promptVersion = prep.promptVersion;
  return {
    ...(plan.resume !== undefined ? { resume: plan.resume } : {}),
    ...(plan.history.length > 0 ? { history: plan.history } : {}),
    ...(plan.deliverHistoryAsPreamble ? { deliverHistoryAsPreamble: true as const } : {}),
    // Reuse the frozen prompt when the session has one; otherwise compile fresh and
    // freeze the result (first turn only).
    ...(frozen !== undefined ? { frozen: { neutral: frozen.neutral, frame: frozen.frame } } : {}),
    ...(persistIn !== undefined && frozen === undefined
      ? {
          onCompile: (compiled: { neutral: NeutralConfig; frame: CapabilityFrame }): void => {
            promptVersion = promptVersionOf(compiled.neutral);
            persistIn.store.setCompilation(persistIn.convId, {
              ...compiled,
              promptVersion,
              configHash: configHashOf(currentConfig),
              config: currentConfig,
              model: modelKey,
            });
          },
        }
      : {}),
    ...(persistIn !== undefined
      ? {
          // Stamp the resume token with the provider/model + frozen prompt it's valid
          // for, so a later model/provider switch OR a deliberate recompile falls back
          // to replay instead of resuming a stale server session.
          onBackendSession: (id: string): void =>
            persistIn.store.setBackendSession(persistIn.convId, id, {
              provider,
              ...(model !== undefined ? { model } : {}),
              ...(promptVersion !== undefined ? { promptVersion } : {}),
            }),
        }
      : {}),
  };
}

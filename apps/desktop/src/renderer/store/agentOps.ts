import { parseAgentsResult, type AgentFile, type AgentSummary } from '@coa/console-viewmodel';
import { nextAgentIdentity } from '../panels/agentIdentity.js';
import { reportFailure, reportNotice } from '../shell/failures.js';
import { settle, type ConsoleBridge } from './bridge.js';
import { agentsValue, setAgents, useDaemonData } from './data.js';
import { setSelectedAgent, useConsoleUi } from './ui.js';

// ---- Agents — the daemon-owned registry (built-in ∪ personal ∪ project, project
// winning). Hydrated from `listAgents` on startup; every edit writes THROUGH to
// the daemon via `saveAgent`/`deleteAgent` (one file per agent — there is no
// whole-list write anymore). A `builtin` agent ships in code: it is never a
// save/delete target, so `updateAgent`/`deleteAgent` refuse it (defense in depth —
// the panel also renders it read-only). ----

export interface AgentCtx {
  bridge: ConsoleBridge;
}

const NEW_AGENT_DESCRIPTION = 'What this agent is for.';

/** The on-disk shape (`AgentFile`) a summary carries once `ref`/`scope` are
 *  stripped back off — the inverse of what `listAgents` hands back. */
function toAgentFile(a: AgentSummary): AgentFile {
  const { ref: _ref, scope: _scope, ...file } = a;
  return file;
}

/** What a failed agent write puts back. Every agent mutation renders its edit
 *  optimistically before the daemon has written anything, so a rejected write has to
 *  restore the list — otherwise the row stays on screen claiming a save that never
 *  landed. `selection` is carried only by the mutations that moved the editor
 *  selection: `claimed` is what they set it to, and the undo fires only while that is
 *  still the selection, so a user who clicked another agent mid-write isn't yanked
 *  back to this one. */
interface AgentUndo {
  agents: AgentSummary[];
  selection?: { claimed: string | undefined; previous: string | undefined };
}

/** On launch, hydrate the agent list (and its load diagnostics) from the daemon's
 *  registry; a failed/malformed read degrades both to their empty floor — the
 *  "No agents yet" empty state, never a mock, and no phantom diagnostics. */
export async function initAgents(ctx: AgentCtx): Promise<void> {
  const loaded = await settle(async () => parseAgentsResult(await ctx.bridge.listAgents()));
  if (loaded.status === 'ok') setAgents(loaded.value.agents, loaded.value.diagnostics);
  else setAgents(agentsValue());
}

/** Re-read the daemon's registry after a mutation settles — the authoritative
 *  reconcile over the optimistic local edit already rendered. This is also the ONLY
 *  path load diagnostics travel: a save/delete can itself introduce a duplicate ref
 *  (another window/process wrote the same file concurrently), so re-fetching rather
 *  than trusting the optimistic copy is what keeps the diagnostics honest. Failures
 *  are swallowed here — the optimistic state already rendered, and the next
 *  successful read/mount reconciles it. */
async function refreshAgents(ctx: AgentCtx): Promise<void> {
  const loaded = await settle(async () => parseAgentsResult(await ctx.bridge.listAgents()));
  if (loaded.status !== 'ok') return;
  setAgents(loaded.value.agents, loaded.value.diagnostics);
}

/** Drive an agent write whose edit is already on screen: reconcile on SETTLE — not
 *  only on success — and restore the pre-edit list when the write failed, so what is
 *  rendered matches what is on disk. Without the restore a rejected write leaves the
 *  row looking saved, which is the console lying about durable state. Advisory
 *  throughout: the failure ALSO surfaces as the list snapping back, never as a throw and
 *  never as a block. The reconcile runs either way and wins whenever the daemon read
 *  succeeds, since disk is the authority over both the optimistic edit and the undo.
 *
 *  `action` names what the user asked for, because the rollback alone is a poor signal:
 *  a row quietly reverting looks a lot like a row that was never edited. */
function commitAgentWrite(
  ctx: AgentCtx,
  write: Promise<unknown>,
  undo: AgentUndo,
  action: string,
): void {
  void write
    .catch((error: unknown) => {
      reportFailure(action, error);
      setAgents(undo.agents);
      const selection = undo.selection;
      if (
        selection !== undefined &&
        useConsoleUi.getState().selectedAgentRef === selection.claimed
      ) {
        setSelectedAgent(selection.previous);
      }
    })
    .then(() => refreshAgents(ctx));
}

export function createAgent(ctx: AgentCtx, scope: 'project' | 'personal'): void {
  const agents = agentsValue();
  const { ref, name } = nextAgentIdentity(agents);
  const file: AgentFile = {
    name,
    description: NEW_AGENT_DESCRIPTION,
    icon: 'bot',
    color: 'slate',
  };
  const undo: AgentUndo = {
    agents,
    selection: { claimed: ref, previous: useConsoleUi.getState().selectedAgentRef },
  };
  setAgents([...agents, { ...file, ref, scope }]);
  setSelectedAgent(ref);
  commitAgentWrite(ctx, ctx.bridge.saveAgent({ ref, scope, file }), undo, 'create that agent');
}

export function updateAgent(
  ctx: AgentCtx,
  ref: string,
  patch: Partial<Omit<AgentSummary, 'ref'>>,
): void {
  const agents = agentsValue();
  const current = agents.find((a) => a.ref === ref);
  if (current === undefined || current.scope === 'builtin') return;
  const prevScope = current.scope;
  const next = { ...current, ...patch };
  // A patched `scope` only ever arrives as 'personal'/'project' (the editor's move
  // action) — anything else (or none) keeps the agent where it already lives.
  const nextScope: 'personal' | 'project' =
    next.scope === 'personal' || next.scope === 'project' ? next.scope : prevScope;
  const undo: AgentUndo = { agents };
  setAgents(agents.map((a) => (a.ref === ref ? { ...next, scope: nextScope } : a)));
  const file = toAgentFile({ ...next, scope: nextScope });
  // A scope move WRITES THE NEW COPY FIRST and removes the old one only once that
  // save resolved. Removing first is what turns a half-finished move into data loss:
  // if the save then fails the agent's file is gone from both scopes and there is
  // nothing left to recover it from. In this order the worst outcome is a copy left
  // behind in the old scope — the file still exists, and the reconcile below re-reads
  // the daemon so the list shows where the agent actually resolves from. Be honest
  // about the cost: the daemon treats the same ref in two scopes as an intentional
  // override, not a diagnostic, so that leftover is silent. Silent and recoverable is
  // still strictly better than gone.
  const saved = ctx.bridge.saveAgent({ ref, scope: nextScope, file });
  if (nextScope === prevScope) {
    commitAgentWrite(ctx, saved, undo, 'save that agent');
    return;
  }
  // A move is TWO writes, so it needs its own report: the generic "couldn't save that
  // agent" names the wrong operation when the copy landed and only the removal of the
  // old file failed (its YAML open in an editor is the everyday cause). Say which half
  // broke — the user is looking at an agent that really is in the new scope, with a
  // stale twin left behind in the old one. Reported and swallowed, not rethrown: the
  // reconcile below re-reads the daemon, so the list still ends up showing the truth,
  // and rolling the edit back would claim the copy never happened. A `removed: false`
  // here stays silent — the old file being gone already IS the finished move.
  const written = saved.then(async () => {
    try {
      await ctx.bridge.deleteAgent({ ref, scope: prevScope });
    } catch (error: unknown) {
      const cause = error instanceof Error ? error.message : String(error);
      reportFailure(
        'finish moving that agent',
        `it was copied to ${nextScope}, but the old ${prevScope} copy could not be removed — ${cause}`,
      );
    }
  });
  commitAgentWrite(ctx, written, undo, 'save that agent');
}

export function deleteAgent(ctx: AgentCtx, ref: string): void {
  const agents = agentsValue();
  const current = agents.find((a) => a.ref === ref);
  if (current === undefined || current.scope === 'builtin') return;
  const undo: AgentUndo = {
    agents,
    selection: { claimed: undefined, previous: useConsoleUi.getState().selectedAgentRef },
  };
  setAgents(agents.filter((a) => a.ref !== ref));
  if (useConsoleUi.getState().selectedAgentRef === ref) setSelectedAgent(undefined);
  // `removed: false` is the answer that used to disappear: the daemon found no file
  // for this agent, so the delete was a no-op. The row goes either way, but the user
  // asked for a removal and nothing was removed — usually because the file had already
  // gone from under the console — and that is worth a word rather than silence.
  const removal = ctx.bridge.deleteAgent({ ref, scope: current.scope }).then((result) => {
    if (!result.removed) {
      reportNotice('Nothing to delete', 'that agent had no file left to remove.');
    }
  });
  commitAgentWrite(ctx, removal, undo, 'delete that agent');
}

/** The diagnostics ride `useDaemonData`; exported for symmetry checks in tests. */
export function agentDiagnostics(): ReturnType<typeof useDaemonData.getState>['agentDiagnostics'] {
  return useDaemonData.getState().agentDiagnostics;
}

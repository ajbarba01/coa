import { useState } from 'react';
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import {
  AgentChip,
  AgentRail,
  Button,
  EmptyState,
  IconButton,
  InlineMessage,
  Pane,
  Skeleton,
  SwitcherMenu,
  Tooltip,
  TooltipProvider,
  Transcript,
} from '@coa/console-ui';
import type { AgentRailItem, RespondFn, SwitcherGroup, TranscriptFrame } from '@coa/console-ui';
import type { AgentSummary, SessionSummary, TurnFrame } from '@coa/console-viewmodel';
import { ChevronDown, MessageSquare, MessageSquarePlus } from 'lucide-react';
import type { ConsoleState } from './state.js';

export type ChatVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      rawMode: boolean;
      frames: TranscriptFrame[];
      onRespond: RespondFn;
      onSend: (text: string) => void;
      toggleRaw: () => void;
      /** The agent drawer + one session switcher (selection follows the session). */
      rail: AgentRailItem[];
      activeAgentRef?: string | undefined;
      sessionTitle: string;
      sessionGroups: SwitcherGroup[];
      onSelectRailAgent: (ref: string) => void;
      onSelectSession: (id: string) => void;
      onDeleteSession: (id: string) => void;
      onNewSession: (ref: string) => void;
      onTogglePin: (ref: string) => void;
      onConfigure: (ref: string) => void;
    };

/** Map a daemon turn frame to its governed transcript frame. Approvals/denies pass
 *  their fields straight through; `resolved` is layered on in a later part from ui state. */
export function toGovernedFrame(f: TurnFrame): TranscriptFrame {
  switch (f.kind) {
    case 'text':
      return { id: f.id, role: f.role, kind: 'text', text: f.text, depth: f.depth };
    case 'tool-use':
      return {
        id: f.id,
        role: f.role,
        kind: 'tool-use',
        tool: f.tool,
        input: f.input,
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
  }
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

/** Pure: rail items — pinned agents first (in list order), then the rest. */
export function buildRailItems(agents: AgentSummary[], pinned: string[]): AgentRailItem[] {
  const item = (a: AgentSummary): AgentRailItem => ({
    id: a.ref,
    name: a.name,
    icon: a.icon,
    color: a.color,
    pinned: pinned.includes(a.ref),
  });
  return [
    ...agents.filter((a) => pinned.includes(a.ref)).map(item),
    ...agents.filter((a) => !pinned.includes(a.ref)).map(item),
  ];
}

const byNewest = (a: SessionSummary, b: SessionSummary): number =>
  Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/** Pure: the one session switcher — the rail-selected agent's sessions first
 *  (newest-first, + New session), then the remaining agents' sessions (no row
 *  appears twice). Picking any row re-points the rail to that session's agent
 *  (selection follows session). */
export function buildSessionGroups(
  sessions: SessionSummary[],
  agents: AgentSummary[],
  activeSessionId: string | undefined,
  agentRef: string | undefined,
  nowIso: string,
): SwitcherGroup[] {
  const agent = agents.find((a) => a.ref === agentRef);
  const chipOf = (ref: string): React.ReactNode => {
    const a = agents.find((x) => x.ref === ref);
    return a ? <AgentChip icon={a.icon} color={a.color} size="sm" /> : undefined;
  };
  const row = (s: SessionSummary, withChip: boolean) => ({
    id: s.id,
    label: s.title,
    meta: relativeTime(s.updatedAt, nowIso),
    leading: withChip ? chipOf(s.agentRef) : undefined,
    selected: s.id === activeSessionId,
  });
  const groups: SwitcherGroup[] = [];
  if (agent) {
    groups.push({
      id: 'agent',
      label: agent.name,
      labelLeading: <AgentChip icon={agent.icon} color={agent.color} size="sm" />,
      options: sessions
        .filter((s) => s.agentRef === agent.ref)
        .sort(byNewest)
        .map((s) => row(s, false)),
      actions: [{ id: 'new-session', label: 'New session', icon: MessageSquarePlus }],
    });
  }
  groups.push({
    id: 'all',
    label: agent ? 'Other agents' : 'All sessions',
    options: sessions
      .filter((s) => s.agentRef !== agent?.ref)
      .sort(byNewest)
      .slice(0, 10)
      .map((s) => row(s, true)),
  });
  return groups;
}

/** Pure: projects the polled turn stream + agent/session state into the chat vm.
 *  In raw mode every frame becomes its verbatim line (D85). */
export function selectChatVm(state: ConsoleState, nowIso = new Date().toISOString()): ChatVm {
  const r = state.data.turns;
  if (r.status !== 'ok') return r;
  const agents = state.data.agents.status === 'ok' ? state.data.agents.value : [];
  const sessions = state.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const { rawMode, resolvedApprovals, activeSessionId } = state.ui;
  const { actions } = state;
  const frames: TranscriptFrame[] = rawMode
    ? r.value.map((f) => ({ id: f.id, kind: 'raw', text: frameToRawLine(f) }))
    : r.value.map((f) => {
        const g = toGovernedFrame(f);
        if (g.kind === 'approval' && resolvedApprovals[g.requestId] !== undefined) {
          return { ...g, resolved: resolvedApprovals[g.requestId] };
        }
        return g;
      });
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeAgentRef = activeSession?.agentRef;
  return {
    status: 'ready',
    rawMode,
    frames,
    onRespond: state.actions.respondApproval,
    onSend: state.actions.sendMessage,
    toggleRaw: state.actions.toggleRaw,
    rail: buildRailItems(agents, state.ui.settings.pinnedAgents),
    activeAgentRef,
    sessionTitle: activeSession?.title ?? 'No session',
    sessionGroups: buildSessionGroups(sessions, agents, activeSessionId, activeAgentRef, nowIso),
    onSelectRailAgent: (ref) => {
      const newest = sessions.filter((s) => s.agentRef === ref).sort(byNewest)[0];
      if (newest) actions.selectSession(newest.id);
      else actions.newSession(ref);
    },
    onSelectSession: actions.selectSession,
    onDeleteSession: actions.deleteSession,
    onNewSession: actions.newSession,
    onTogglePin: actions.togglePinAgent,
    onConfigure: (ref) => {
      actions.selectAgent(ref);
      actions.setRoute('agents');
    },
  };
}

/** The `raw` escape lives on the always-visible chat pane (D85). It is a stateful
 *  toggle — brass/pressed when the unfiltered loop is showing (P5 feedback). */
function RawToggle({ on, onToggle }: { on: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <Button variant={on ? 'primary' : 'tertiary'} size="sm" aria-pressed={on} onClick={onToggle}>
      raw
    </Button>
  );
}

/** The chat composer: a single-line prompt entry; Enter sends, empty is inert. */
function Composer({ onSend }: { onSend: (text: string) => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const send = (): void => {
    const body = text.trim();
    if (body === '') return;
    onSend(body);
    setText('');
  };
  return (
    <div className="flex items-center gap-2 border-t border-border-default p-2.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Message the agent…"
        aria-label="Message the agent"
        className="h-control-md flex-1 rounded-control border border-border-default bg-element px-2.5 text-body text-fg placeholder:text-faint"
      />
      <Button variant="primary" size="sm" onClick={send} disabled={text.trim() === ''}>
        Send
      </Button>
    </div>
  );
}

function ChatView({ vm }: { vm: ChatVm; host: PanelHostApi }): React.JSX.Element {
  if (vm.status !== 'ready') {
    return (
      <Pane title="Chat">
        {vm.status === 'loading' && (
          <div className="flex flex-col gap-2">
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/2" />
          </div>
        )}
        {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      </Pane>
    );
  }
  return (
    <Pane
      title={vm.rawMode ? 'Chat · raw' : 'Chat'}
      titleSlot={
        <TooltipProvider>
          <div className="flex min-w-0 items-center gap-1">
            <SwitcherMenu
              label="Sessions"
              searchable
              openOnHover
              trigger={
                <Button
                  variant="tertiary"
                  size="sm"
                  className="min-w-0 max-w-56"
                  aria-label="Switch session"
                  pressScale={false}
                >
                  <span className="truncate">{vm.sessionTitle}</span>
                  <ChevronDown aria-hidden size={14} className="shrink-0 text-muted" />
                </Button>
              }
              groups={vm.sessionGroups}
              onSelect={vm.onSelectSession}
              onDelete={vm.onDeleteSession}
              onAction={(id) => {
                if (id === 'new-session' && vm.activeAgentRef !== undefined)
                  vm.onNewSession(vm.activeAgentRef);
              }}
            />
            <Tooltip content="New session">
              <IconButton
                icon={MessageSquarePlus}
                label="New session"
                variant="tertiary"
                size="sm"
                disabled={vm.activeAgentRef === undefined}
                onClick={() => {
                  if (vm.activeAgentRef !== undefined) vm.onNewSession(vm.activeAgentRef);
                }}
              />
            </Tooltip>
          </div>
        </TooltipProvider>
      }
      actions={<RawToggle on={vm.rawMode} onToggle={vm.toggleRaw} />}
      flush
    >
      <div className="flex h-full min-h-0">
        <AgentRail
          items={vm.rail}
          side="left"
          {...(vm.activeAgentRef !== undefined ? { activeId: vm.activeAgentRef } : {})}
          onSelect={vm.onSelectRailAgent}
          onNewSession={vm.onNewSession}
          onTogglePin={vm.onTogglePin}
          onConfigure={vm.onConfigure}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-3.5">
            {vm.frames.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No conversation yet"
                description="Message the agent below to start a governed session."
              />
            ) : (
              <Transcript frames={vm.frames} onRespond={vm.onRespond} label="Conversation" />
            )}
          </div>
          <Composer onSend={vm.onSend} />
        </div>
      </div>
    </Pane>
  );
}

export const chatPanel: PanelDefinition<ChatVm, ConsoleState> = {
  id: 'conversation',
  displayName: 'Chat',
  render: ChatView,
  selectVm: selectChatVm,
};

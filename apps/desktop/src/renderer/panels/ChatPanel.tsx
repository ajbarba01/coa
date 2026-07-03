import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import {
  AgentChip,
  AgentRail,
  Badge,
  Banner as BannerCard,
  Button,
  Combobox,
  Composer,
  EmptyState,
  IconButton,
  InlineMessage,
  Pane,
  Select,
  Skeleton,
  SwitcherMenu,
  Tooltip,
  TooltipProvider,
  Transcript,
} from '@coa/console-ui';
import { useEffect, useState } from 'react';
import type { AgentRailItem, RespondFn, SwitcherGroup, TranscriptFrame } from '@coa/console-ui';
import type {
  AgentSummary,
  Banner,
  ModelDescriptor,
  SessionSummary,
  TurnFrame,
} from '@coa/console-viewmodel';
import { effortOptions, reasoningValue, toReasoning } from '@coa/console-viewmodel';
import { modelPickerLabel } from './AgentsPanel.js';
import { computeChatBanners } from './banners.js';
import { ChevronDown, MessageSquare, MessageSquarePlus } from 'lucide-react';
import type { ConsoleState } from './state.js';

export type ChatVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      rawMode: boolean;
      frames: TranscriptFrame[];
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
      /** Phase-1 status floor — `running` while a send is in flight, cleared on the next
       *  appended turn. The full 6-state `status` Push (Phase 2) replaces this. */
      sessionStatus: 'idle' | 'running';
      /** Epoch ms the in-flight send started; set only while `sessionStatus === 'running'`. */
      runningSince?: number;
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
    case 'thinking':
      return { id: f.id, role: f.role, kind: 'thinking', text: f.text, depth: f.depth };
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
  // With no active session (a fresh store), default the rail selection to the first
  // agent so "New session" is enabled — otherwise the first session can never be
  // created (it needs an active agent, which only a session provides).
  const activeAgentRef = activeSession?.agentRef ?? agents[0]?.ref;
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
      ...(activeAgent?.role !== undefined ? { role: activeAgent.role } : {}),
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
  return {
    status: 'ready',
    rawMode,
    frames,
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
    sessionStatus: state.ui.sending ? 'running' : 'idle',
    ...(state.ui.sentAt !== undefined ? { runningSince: state.ui.sentAt } : {}),
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

/** Phase-1 status floor: a `Badge` showing idle, or a live "running for Ns" elapsed
 *  counter while a send is in flight. Ticks client-side via a 1s interval — no wire
 *  change. Placeholder for the full 6-state `status` Push (Phase 2). */
function RunningPill({ since }: { since?: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === undefined ? (
    <Badge tone="neutral">idle</Badge>
  ) : (
    <Badge tone="info">running for {formatElapsed(since, now)}</Badge>
  );
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
            <RunningPill {...(vm.sessionStatus === 'running' ? { since: vm.runningSince } : {})} />
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
          <BannerStrip banners={vm.banners} onAction={vm.onBannerAction} />
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
          <Composer
            onSend={vm.onSend}
            slotStart={
              <>
                <Combobox
                  label="Model"
                  className="max-w-[10rem]"
                  options={
                    vm.models.length > 0
                      ? vm.models.map((m) => ({ value: m.id, label: modelPickerLabel(m) }))
                      : vm.currentModelId !== undefined
                        ? [{ value: vm.currentModelId, label: vm.currentModelId }]
                        : []
                  }
                  {...(vm.currentModelId !== undefined ? { value: vm.currentModelId } : {})}
                  onValueChange={vm.onPickModel}
                  placeholder="Default model"
                />
                {vm.effortOptions.length > 0 && (
                  <Select
                    label="Effort"
                    className="max-w-[8rem]"
                    options={vm.effortOptions}
                    value={vm.effortValue}
                    onValueChange={vm.onPickEffort}
                  />
                )}
              </>
            }
          />
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

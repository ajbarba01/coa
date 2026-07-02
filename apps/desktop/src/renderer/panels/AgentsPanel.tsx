import { useState } from 'react';
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import type {
  AgentSummary,
  ClaudeEffort,
  ClaudeReasoning,
  ModelDescriptor,
} from '@coa/console-viewmodel';
import {
  AgentChip,
  Badge,
  Button,
  Code,
  Combobox,
  Dialog,
  Divider,
  EmptyState,
  IconButton,
  IdentityPicker,
  InlineEdit,
  InlineMessage,
  Menu,
  Pane,
  Skeleton,
  SwitcherMenu,
  TextField,
} from '@coa/console-ui';
import type { MenuItem, SwitcherGroup } from '@coa/console-ui';
import {
  Bot,
  ChevronDown,
  Copy,
  FolderInput,
  MoreHorizontal,
  Pin,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ConsoleState } from './state.js';

/** The full effort ladder — used only as a fallback before the live model list loads. */
const ALL_EFFORTS: ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Collapse a ClaudeReasoning to the selector value it displays as. */
export function reasoningToValue(r: ClaudeReasoning | undefined): string {
  if (r === undefined) return 'default';
  if (r.mode === 'off') return 'off';
  if (r.mode === 'budget') return 'budget';
  return r.effort;
}

/**
 * The faithful reasoning control. Its options are gated to the SELECTED model's
 * real `supportedEffortLevels` (Haiku ≠ Opus); when the model's caps aren't known
 * yet (list still loading) it falls back to the full ladder. `off` and `default`
 * (no override) are always available; the token-budget mode appears when the model
 * supports adaptive thinking.
 */
function ReasoningField({
  reasoning,
  efforts,
  includeBudget,
  onChange,
}: {
  reasoning: ClaudeReasoning | undefined;
  efforts: ClaudeEffort[];
  includeBudget: boolean;
  onChange: (r: ClaudeReasoning | undefined) => void;
}): React.JSX.Element {
  const value = reasoningToValue(reasoning);
  const budget = reasoning?.mode === 'budget' ? reasoning.budgetTokens : 8000;
  const values = ['default', 'off', ...efforts, ...(includeBudget ? ['budget'] : [])];
  const select = (v: string): void => {
    if (v === 'default') onChange(undefined);
    else if (v === 'off') onChange({ mode: 'off' });
    else if (v === 'budget') onChange({ mode: 'budget', budgetTokens: budget });
    else if ((efforts as string[]).includes(v)) onChange({ mode: 'effort', effort: v as ClaudeEffort });
  };
  return (
    <div className="flex flex-col gap-2">
      <Combobox
        label="Reasoning"
        value={value}
        onValueChange={select}
        options={values.map((v) => ({ value: v, label: v === 'default' ? 'default (SDK)' : v }))}
      />
      {value === 'budget' && (
        <TextField
          label="Thinking token budget"
          type="number"
          value={String(budget)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n > 0) onChange({ mode: 'budget', budgetTokens: n });
          }}
        />
      )}
    </div>
  );
}

export type AgentsVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty'; createAgent: (scope: 'project' | 'personal') => void }
  | {
      status: 'ready';
      agents: AgentSummary[];
      selected: AgentSummary;
      models: ModelDescriptor[];
      pinned: string[];
      selectAgent: (ref: string) => void;
      createAgent: (scope: 'project' | 'personal') => void;
      updateAgent: (ref: string, patch: Partial<Omit<AgentSummary, 'ref'>>) => void;
      deleteAgent: (ref: string) => void;
      togglePinAgent: (ref: string) => void;
    };

/** Pure: the editor opens on ui.selectedAgentRef, falling back to the first agent. */
export function selectAgentsVm(state: ConsoleState): AgentsVm {
  const r = state.data.agents;
  if (r.status !== 'ok') return r;
  const agents = r.value;
  const { selectAgent, createAgent, updateAgent, deleteAgent, togglePinAgent } = state.actions;
  if (agents.length === 0) return { status: 'empty', createAgent };
  const selected = agents.find((a) => a.ref === state.ui.selectedAgentRef) ?? agents[0]!;
  const models = state.data.models.status === 'ok' ? state.data.models.value : [];
  return {
    status: 'ready',
    agents,
    selected,
    models,
    pinned: state.ui.settings.pinnedAgents,
    selectAgent,
    createAgent,
    updateAgent,
    deleteAgent,
    togglePinAgent,
  };
}

/** Pure: picker groups — Pinned (when any) → Project → Personal → the create row.
 *  The picker only selects; identity editing lives in the editor header. */
export function buildAgentPickerGroups(
  agents: AgentSummary[],
  pinned: string[],
  selectedRef: string,
): SwitcherGroup[] {
  const isPinned = (a: AgentSummary): boolean => pinned.includes(a.ref);
  const row = (a: AgentSummary) => ({
    id: a.ref,
    label: a.name,
    meta: a.model,
    leading: <AgentChip icon={a.icon} color={a.color} size="sm" />,
    selected: a.ref === selectedRef,
    pinned: isPinned(a),
  });
  return [
    { id: 'pinned', label: 'Pinned', options: agents.filter(isPinned).map(row) },
    {
      id: 'project',
      label: 'Project',
      options: agents.filter((a) => a.scope === 'project' && !isPinned(a)).map(row),
    },
    {
      id: 'personal',
      label: 'Personal',
      options: agents.filter((a) => a.scope === 'personal' && !isPinned(a)).map(row),
    },
    { id: 'create', options: [], actions: [{ id: 'new-agent', label: 'New agent', icon: Plus }] },
  ];
}

/** The identity header + overflow: every identity concern in one cluster (the
 *  Linear/Notion pattern); the danger path confirms in a Dialog — project agents
 *  are shared via git, so their delete types the name. */
function AgentEditor({ vm }: { vm: Extract<AgentsVm, { status: 'ready' }> }): React.JSX.Element {
  const a = vm.selected;
  const selectedModel = vm.models.find((m) => m.id === a.model);
  const pinned = vm.pinned.includes(a.ref);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteDraft, setDeleteDraft] = useState('');
  const deleteBlocked = a.scope === 'project' && deleteDraft !== a.name;

  const overflow: MenuItem[] = [
    {
      id: 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      icon: Pin,
      onSelect: () => vm.togglePinAgent(a.ref),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      onSelect: () => vm.createAgent(a.scope),
    },
    {
      id: 'move',
      label: a.scope === 'project' ? 'Move to Personal' : 'Move to Project',
      icon: FolderInput,
      onSelect: () =>
        vm.updateAgent(a.ref, { scope: a.scope === 'project' ? 'personal' : 'project' }),
    },
    {
      id: 'delete',
      label: 'Delete…',
      icon: Trash2,
      onSelect: () => {
        setDeleteDraft('');
        setConfirmingDelete(true);
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <IdentityPicker
          icon={a.icon}
          color={a.color}
          label={a.name}
          onIconChange={(icon) => vm.updateAgent(a.ref, { icon })}
          onColorChange={(color) => vm.updateAgent(a.ref, { color })}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <InlineEdit
            value={a.name}
            label="Agent name"
            textClassName="text-heading font-semibold"
            onCommit={(name) => vm.updateAgent(a.ref, { name })}
          />
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{a.scope === 'project' ? 'Project' : 'Personal'}</Badge>
            <Code>{a.ref}</Code>
            {pinned && <Badge tone="info">pinned</Badge>}
          </div>
        </div>
        <Menu
          trigger={
            <IconButton
              label="Agent actions"
              icon={MoreHorizontal}
              variant="tertiary"
              size="sm"
              pressScale={false}
            />
          }
          items={overflow}
        />
      </div>

      <Divider />

      <div className="flex max-w-md flex-col gap-3">
        <Combobox
          label="Model"
          value={a.model ?? vm.models[0]?.id ?? ''}
          onValueChange={(model) => vm.updateAgent(a.ref, { model })}
          options={
            vm.models.length > 0
              ? vm.models.map((m) => ({ value: m.id, label: m.displayName ?? m.id }))
              : a.model !== undefined
                ? [{ value: a.model, label: a.model }]
                : []
          }
        />
        <ReasoningField
          reasoning={a.reasoning}
          efforts={selectedModel?.supportedEffortLevels ?? ALL_EFFORTS}
          includeBudget={selectedModel?.supportsAdaptiveThinking ?? true}
          onChange={(reasoning) => vm.updateAgent(a.ref, { reasoning })}
        />
        <p className="text-caption text-faint">
          Reasoning levels reflect the selected model's real capabilities. Context pieces and the
          full role configuration arrive with the agent-config seam.
        </p>
      </div>

      <Dialog
        open={confirmingDelete}
        onOpenChange={(open) => setConfirmingDelete(open)}
        title={`Delete ${a.name}?`}
        description={
          a.scope === 'project'
            ? 'This agent is committed in .coa/ and shared with collaborators. Type its name to confirm.'
            : 'This personal agent and its local configuration will be removed.'
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleteBlocked}
              onClick={() => {
                setConfirmingDelete(false);
                vm.deleteAgent(a.ref);
              }}
            >
              Delete agent
            </Button>
          </>
        }
      >
        {a.scope === 'project' && (
          <TextField
            label="Agent name"
            value={deleteDraft}
            onChange={(e) => setDeleteDraft(e.target.value)}
            placeholder={a.name}
          />
        )}
      </Dialog>
    </div>
  );
}

function AgentsView({ vm }: { vm: AgentsVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <Pane title="Agents" scroll seam="left">
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-control-md w-56" />
          <Skeleton className="h-10 w-72" />
          <Skeleton className="w-2/3" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'empty' && (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Create an agent to configure how the loop works in this project."
          action={
            <Button size="sm" onClick={() => vm.createAgent('project')}>
              New agent
            </Button>
          }
        />
      )}
      {vm.status === 'ready' && (
        <div className="flex flex-col gap-4">
          <SwitcherMenu
            label="Agents"
            searchable
            trigger={
              <Button
                variant="secondary"
                size="sm"
                aria-label="Switch agent"
                className="self-start"
                pressScale={false}
              >
                <AgentChip icon={vm.selected.icon} color={vm.selected.color} size="sm" />
                {vm.selected.name}
                <ChevronDown aria-hidden size={14} className="text-muted" />
              </Button>
            }
            groups={buildAgentPickerGroups(vm.agents, vm.pinned, vm.selected.ref)}
            onSelect={vm.selectAgent}
            onTogglePin={vm.togglePinAgent}
            onAction={(id) => {
              if (id === 'new-agent') vm.createAgent('project');
            }}
          />
          <AgentEditor key={vm.selected.ref} vm={vm} />
        </div>
      )}
    </Pane>
  );
}

export const agentsPanel: PanelDefinition<AgentsVm, ConsoleState> = {
  id: 'agents',
  displayName: 'Agents',
  render: AgentsView,
  selectVm: selectAgentsVm,
};

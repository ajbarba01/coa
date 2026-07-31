import { useState } from 'react';
import type {
  AgentSummary,
  ClaudeEffort,
  ClaudeReasoning,
  ModelDescriptor,
  PackageSummary,
  RoleSummary,
} from '@coa/console-viewmodel';
import {
  AgentChip,
  Badge,
  Button,
  Checkbox,
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
  Select,
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

/**
 * The picker label: the model's version — the first "·"-delimited segment of the
 * SDK description (e.g. "Opus 4.8"). The account exposes named aliases whose
 * version lives only in the description, so we surface it. When the display name
 * isn't already part of that version (the "Default (recommended)" alias), keep it
 * as a prefix; with no description, fall back to the display name, then the id.
 */
export function modelLabel(m: ModelDescriptor): string {
  const version = m.description?.split('·')[0]?.trim();
  if (version === undefined || version === '') return m.displayName ?? m.id;
  const name = m.displayName;
  if (name !== undefined && !version.toLowerCase().startsWith(name.toLowerCase())) {
    return `${name} · ${version}`;
  }
  return version;
}

const PROVIDER_LABELS: Record<string, string> = { claude: 'Claude', deepseek: 'DeepSeek' };

/**
 * The picker label for a model in the MERGED (multi-provider) list — the model's
 * version prefixed with its backend (e.g. "DeepSeek · V4 Pro") so a combined list
 * reads clearly and stays searchable by provider. Untagged models show plainly.
 */
export function modelPickerLabel(m: ModelDescriptor): string {
  const base = modelLabel(m);
  if (m.provider === undefined) return base;
  return `${PROVIDER_LABELS[m.provider] ?? m.provider} · ${base}`;
}

/**
 * The reasoning options for the selected model. A RESOLVED model's real
 * `supportedEffortLevels` win (empty ⇒ no effort control, e.g. Haiku); an
 * unresolved id — the list is still loading, or the id isn't in this account's
 * list — falls back to the full ladder so the choice is never caged.
 */
export function modelReasoningCaps(
  models: ModelDescriptor[],
  modelId: string | undefined,
): { efforts: ClaudeEffort[]; includeBudget: boolean; thinkingToggle: boolean } {
  const selected = models.find((m) => m.id === modelId);
  if (selected === undefined)
    return { efforts: ALL_EFFORTS, includeBudget: true, thinkingToggle: false };
  return {
    efforts: selected.supportedEffortLevels ?? [],
    includeBudget: selected.supportsAdaptiveThinking ?? false,
    // A pure-API model with a binary thinking on/off toggle and no graded ladder (e.g. LongCat).
    thinkingToggle: selected.supportsThinking ?? false,
  };
}

/**
 * The models offered in the picker. The SDK's `default` alias points at the
 * account's default model, so it duplicates a named entry — hide it (leaving a
 * model unset already means "let the backend choose the default").
 */
export function pickableModels(models: ModelDescriptor[]): ModelDescriptor[] {
  return models.filter((m) => m.id !== 'default');
}

/**
 * Keep a reasoning selection valid across a model switch: return it unchanged when
 * the newly-selected model still supports it, otherwise drop back to the default
 * (undefined). `off` and `default` are always valid; an effort must be offered by
 * the model; a token budget needs adaptive thinking.
 */
export function clampReasoning(
  reasoning: ClaudeReasoning | undefined,
  caps: { efforts: ClaudeEffort[]; includeBudget: boolean; thinkingToggle?: boolean },
): ClaudeReasoning | undefined {
  if (reasoning === undefined || reasoning.mode === 'off') return reasoning;
  if (reasoning.mode === 'budget') return caps.includeBudget ? reasoning : undefined;
  // A thinking-toggle model carries its "on" state as an effort sentinel with no ladder,
  // so any effort is valid when the toggle is present.
  return caps.efforts.includes(reasoning.effort) || caps.thinkingToggle === true
    ? reasoning
    : undefined;
}

type PackagePatch = Partial<Pick<AgentSummary, 'packageIds' | 'exclude'>>;

/**
 * The packages an agent currently includes: the `default` packages + the UNION of
 * every selected role's opt-ins + the user's added opt-ins, minus the user's
 * exclusions. Mirrors the M8 resolver so the picker shows exactly what the backend
 * would assemble.
 */
export function includedPackageIds(
  packages: PackageSummary[],
  roles: RoleSummary[],
  agent: Pick<AgentSummary, 'packageIds' | 'exclude'>,
): Set<string> {
  const excluded = new Set(agent.exclude ?? []);
  const base = new Set<string>();
  for (const p of packages) if (p.inclusion === 'default') base.add(p.id);
  for (const role of roles) for (const id of role.packageIds ?? []) base.add(id);
  for (const id of agent.packageIds ?? []) base.add(id);
  return new Set([...base].filter((id) => !excluded.has(id)));
}

/** The advised-but-absent packages — coa's nudge list (a hint, never a block). */
export function packageAdvisories(
  packages: PackageSummary[],
  included: ReadonlySet<string>,
): PackageSummary[] {
  return packages.filter((p) => p.advise === true && !included.has(p.id));
}

/**
 * The patch toggling one package on/off, respecting how it entered the set: a
 * purely user-added opt-in leaves via `packageIds`; anything a default or any
 * selected role brings in must be actively excluded (and re-including it clears
 * that exclusion).
 */
export function togglePackage(
  packages: PackageSummary[],
  roles: RoleSummary[],
  agent: Pick<AgentSummary, 'packageIds' | 'exclude'>,
  id: string,
): PackagePatch {
  const packageIds = agent.packageIds ?? [];
  const exclude = agent.exclude ?? [];
  const isDefault = packages.some((p) => p.id === id && p.inclusion === 'default');
  const fromRole = roles.some((role) => (role.packageIds ?? []).includes(id));
  if (includedPackageIds(packages, roles, agent).has(id)) {
    if (!isDefault && !fromRole) return { packageIds: packageIds.filter((p) => p !== id) };
    return { exclude: [...exclude, id] };
  }
  if (exclude.includes(id)) return { exclude: exclude.filter((p) => p !== id) };
  return { packageIds: [...packageIds, id] };
}

/**
 * The effort sentinel a binary thinking toggle stores for its "on" state. The reasoning
 * union has no `on` mode, and every pure-API backend exposing a thinking toggle reads any
 * `mode:'effort'` as thinking-enabled — so "on" round-trips as an effort value.
 */
const THINKING_ON: ClaudeEffort = 'high';

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
  thinkingToggle,
  onChange,
}: {
  reasoning: ClaudeReasoning | undefined;
  efforts: ClaudeEffort[];
  includeBudget: boolean;
  thinkingToggle: boolean;
  onChange: (r: ClaudeReasoning | undefined) => void;
}): React.JSX.Element {
  const budget = reasoning?.mode === 'budget' ? reasoning.budgetTokens : 8000;
  // A thinking-toggle model has a binary On/Off (no ladder, no budget); "on" carries the
  // effort sentinel, so an effort reasoning displays as 'on'.
  const value = thinkingToggle && reasoning?.mode === 'effort' ? 'on' : reasoningToValue(reasoning);
  const values = thinkingToggle
    ? ['default', 'off', 'on']
    : ['default', 'off', ...efforts, ...(includeBudget ? ['budget'] : [])];
  const select = (v: string): void => {
    if (v === 'default') onChange(undefined);
    else if (v === 'off') onChange({ mode: 'off' });
    else if (v === 'on') onChange({ mode: 'effort', effort: THINKING_ON });
    else if (v === 'budget') onChange({ mode: 'budget', budgetTokens: budget });
    else if ((efforts as string[]).includes(v))
      onChange({ mode: 'effort', effort: v as ClaudeEffort });
  };
  return (
    <div className="flex flex-col gap-2">
      <Select
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
      roles: RoleSummary[];
      packages: PackageSummary[];
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
  const models = state.data.models.status === 'ok' ? pickableModels(state.data.models.value) : [];
  const roles = state.data.roles.status === 'ok' ? state.data.roles.value : [];
  const packages = state.data.packages.status === 'ok' ? state.data.packages.value : [];
  return {
    status: 'ready',
    agents,
    selected,
    models,
    roles,
    packages,
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
  const caps = modelReasoningCaps(vm.models, a.model);
  const selectedRoles = vm.roles.filter((r) => (a.roles ?? []).includes(r.id));
  const included = includedPackageIds(vm.packages, selectedRoles, a);
  const advisories = packageAdvisories(vm.packages, included);
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
          onValueChange={(model) => {
            // The empty-list "backend default" row is a statement, not a value — picking
            // it must not write an empty model id onto the agent.
            if (model === '') return;
            // The chosen model carries its provider (the list is merged across backends);
            // store it so the session routes there. Keep the reasoning valid for the new
            // model (an effort/budget it doesn't offer resets to default).
            const picked = vm.models.find((m) => m.id === model);
            const clamped = clampReasoning(a.reasoning, modelReasoningCaps(vm.models, model));
            vm.updateAgent(a.ref, {
              model,
              ...(picked?.provider !== undefined ? { provider: picked.provider } : {}),
              ...(clamped !== a.reasoning ? { reasoning: clamped } : {}),
            });
          }}
          options={
            vm.models.length > 0
              ? vm.models.map((m) => ({ value: m.id, label: modelPickerLabel(m) }))
              : a.model !== undefined
                ? [{ value: a.model, label: a.model }]
                : // An emptied list degrades honestly: the backend default runs, so the
                  // picker says so rather than opening on nothing.
                  [{ value: '', label: 'backend default' }]
          }
        />
        <ReasoningField
          reasoning={a.reasoning}
          efforts={caps.efforts}
          includeBudget={caps.includeBudget}
          thinkingToggle={caps.thinkingToggle}
          onChange={(reasoning) => vm.updateAgent(a.ref, { reasoning })}
        />

        {vm.roles.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-caption text-muted">Roles</span>
            {vm.roles.map((r) => (
              <Checkbox
                key={r.id}
                label={r.name}
                checked={(a.roles ?? []).includes(r.id)}
                onCheckedChange={(checked) =>
                  vm.updateAgent(a.ref, {
                    roles: checked
                      ? [...(a.roles ?? []), r.id]
                      : (a.roles ?? []).filter((id) => id !== r.id),
                  })
                }
              />
            ))}
          </div>
        )}

        {vm.packages.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-caption text-muted">Packages</span>
            {vm.packages.map((p) => (
              <Checkbox
                key={p.id}
                label={p.inclusion === 'default' ? `${p.name} · default` : p.name}
                checked={included.has(p.id)}
                onCheckedChange={() =>
                  vm.updateAgent(a.ref, togglePackage(vm.packages, selectedRoles, a, p.id))
                }
              />
            ))}
            {advisories.length > 0 && (
              <InlineMessage tone="info">
                Recommended: {advisories.map((p) => p.name).join(', ')}
              </InlineMessage>
            )}
          </div>
        )}

        <p className="text-caption text-faint">
          The roles, model, and package selection take effect on the next message. Packages apply
          once one or more roles are selected (with no roles the agent runs the permissive
          baseline).
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

function AgentsView({ vm }: { vm: AgentsVm }): React.JSX.Element {
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

/** State-fed surface: computes the vm from console state and renders the agents editor. */
export function AgentsSurface({ state }: { state: ConsoleState }): React.JSX.Element {
  return <AgentsView vm={selectAgentsVm(state)} />;
}

// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentsStrip,
  AgentsSurface,
  clampReasoning,
  matchesAgent,
  modelLabel,
  modelPickerLabel,
  modelPickerOptions,
  pickableModels,
  selectAgentsVm,
} from './AgentsPanel.js';
import { useAgentsUi } from './agentsUi.js';
import { useLibraryStore } from './libraryStore.js';
import { makeState, resetStores, seedState, type StateOverrides } from '../testing/fixtures.js';
import { MOCK_AGENTS } from '../testing/mockAgents.js';
import { PKGS } from './resolvedSet.test.js';
import type {
  AgentDiagnostic,
  AgentSummary,
  ModelDescriptor,
  PackageSummary,
  RoleSummary,
} from '@coa/console-viewmodel';
import type { ConsoleState } from './state.js';

/** Both stores are module-level (they feed the strip AND the surface body, which are
 *  kept-alive siblings under `Center` in the real shell), so each test starts from the
 *  same shape rather than its predecessor's leftovers. */
// `useNarrow` measures a real element, which jsdom never resizes. Driving it directly is
// the only way to exercise the drill-down shape the pane measurement selects.
let measuredNarrow = false;
vi.mock('./useNarrow.js', () => ({ useNarrow: () => measuredNarrow }));

const AGENTS_UI_SEED = useAgentsUi.getState();
beforeEach(() => {
  measuredNarrow = false;
  useAgentsUi.setState(AGENTS_UI_SEED, true);
  resetStores();
});

/** The live SDK model list shape (aliases + version-in-description), per `supportedModels()`. */
const OPUS: ModelDescriptor = {
  id: 'opus',
  displayName: 'Opus',
  description: 'Opus 4.8 · Best for everyday, complex tasks · ~2× usage vs Sonnet',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  supportsAdaptiveThinking: true,
};
const SONNET: ModelDescriptor = {
  id: 'sonnet',
  displayName: 'Sonnet',
  description: 'Sonnet 4.6 · Efficient for routine tasks',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  supportsAdaptiveThinking: true,
};
const HAIKU: ModelDescriptor = {
  id: 'haiku',
  displayName: 'Haiku',
  description: 'Haiku 4.5 · Fastest for quick answers',
};
/** A pure-API model with a binary thinking toggle and no graded effort ladder (LongCat). */
const LONGCAT: ModelDescriptor = { id: 'LongCat-2.0', provider: 'longcat', supportsThinking: true };
const DEFAULT_MODEL: ModelDescriptor = {
  id: 'default',
  displayName: 'Default (recommended)',
  description: 'Sonnet 4.6 · Efficient for routine tasks',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  supportsAdaptiveThinking: true,
};
const MODELS = [DEFAULT_MODEL, SONNET, OPUS, HAIKU];

describe('modelLabel', () => {
  it('shows the version from the description when the name is already in it', () => {
    expect(modelLabel(OPUS)).toBe('Opus 4.8');
    expect(modelLabel(SONNET)).toBe('Sonnet 4.6');
    expect(modelLabel(HAIKU)).toBe('Haiku 4.5');
    expect(
      modelLabel({
        id: 'claude-fable-5[1m]',
        displayName: 'Fable',
        description: 'Fable 5 · Most capable',
      }),
    ).toBe('Fable 5');
  });

  it('keeps a distinct display name alongside the version (the default alias)', () => {
    expect(modelLabel(DEFAULT_MODEL)).toBe('Default (recommended) · Sonnet 4.6');
  });

  it('falls back to the display name, then the id, when there is no description', () => {
    expect(modelLabel({ id: 'x', displayName: 'X' })).toBe('X');
    expect(modelLabel({ id: 'raw-id' })).toBe('raw-id');
  });
});

describe('modelPickerLabel', () => {
  it('prefixes the provider in the merged list, leaving untagged models plain', () => {
    expect(modelPickerLabel({ id: 'deepseek-v4-pro', provider: 'deepseek' })).toBe(
      'DeepSeek · deepseek-v4-pro',
    );
    expect(modelPickerLabel({ id: 'x', displayName: 'X', provider: 'claude' })).toBe('Claude · X');
    expect(modelPickerLabel(OPUS)).toBe('Opus 4.8');
  });
});

describe('modelPickerOptions', () => {
  it('sorts an interleaved model list into one contiguous run per backend (one group header each, never fragmented)', () => {
    const claudeA: ModelDescriptor = { id: 'opus', provider: 'claude' };
    const deepseek: ModelDescriptor = { id: 'ds-v4', provider: 'deepseek' };
    const claudeB: ModelDescriptor = { id: 'sonnet', provider: 'claude' };
    const longcat: ModelDescriptor = { id: 'LongCat-2.0', provider: 'longcat' };
    const options = modelPickerOptions([claudeA, deepseek, claudeB, longcat], undefined);
    expect(options.map((o) => o.group)).toEqual(['Claude', 'Claude', 'DeepSeek', 'LongCat']);
    const transitions = options.filter((o, i) => i === 0 || o.group !== options[i - 1]!.group);
    expect(transitions).toHaveLength(3);
  });

  it('keeps each backend’s models in their original relative order (a stable sort, not a re-sort within the backend)', () => {
    const sonnet: ModelDescriptor = { id: 'sonnet', provider: 'claude' };
    const deepseek: ModelDescriptor = { id: 'ds-v4', provider: 'deepseek' };
    const opus: ModelDescriptor = { id: 'opus', provider: 'claude' };
    const longcat: ModelDescriptor = { id: 'LongCat-2.0', provider: 'longcat' };
    const options = modelPickerOptions([sonnet, deepseek, opus, longcat], undefined);
    expect(options.map((o) => o.value)).toEqual(['sonnet', 'opus', 'ds-v4', 'LongCat-2.0']);
  });
});

describe('pickableModels', () => {
  it('drops the duplicate "default" alias but keeps the named models in order', () => {
    expect(pickableModels(MODELS).map((m) => m.id)).toEqual(['sonnet', 'opus', 'haiku']);
  });

  it('is a no-op on an empty list', () => {
    expect(pickableModels([])).toEqual([]);
  });
});

describe('clampReasoning', () => {
  it('keeps a reasoning the new model still offers', () => {
    const r = { mode: 'effort', effort: 'high' } as const;
    expect(clampReasoning(r, SONNET)).toBe(r);
  });

  it('falls back to the ladder’s first stop when the new model does not offer the current effort', () => {
    const r = { mode: 'effort', effort: 'xhigh' } as const;
    expect(clampReasoning(r, SONNET)).toEqual({ mode: 'off' });
  });

  it('clears reasoning entirely for a model with no reasoning surface at all (Haiku)', () => {
    expect(clampReasoning({ mode: 'effort', effort: 'low' }, HAIKU)).toBeUndefined();
    expect(clampReasoning({ mode: 'budget', budgetTokens: 8000 }, HAIKU)).toBeUndefined();
  });

  it('leaves an unset reasoning alone when the new model still offers off', () => {
    expect(clampReasoning(undefined, SONNET)).toBeUndefined();
  });

  it('leaves an unresolved model’s reasoning cleared (no ladder to clamp against)', () => {
    const r = { mode: 'effort', effort: 'high' } as const;
    expect(clampReasoning(r, undefined)).toBeUndefined();
  });

  it('keeps the on-state (an effort) for a thinking-toggle model that offers no graded ladder', () => {
    const on = { mode: 'effort', effort: 'high' } as const;
    expect(clampReasoning(on, LONGCAT)).toBe(on);
  });

  it('falls back to off for a thinking-toggle model when the stored value is not its on-sentinel', () => {
    const stale = { mode: 'effort', effort: 'low' } as const;
    expect(clampReasoning(stale, LONGCAT)).toEqual({ mode: 'off' });
  });
});

const ROLES: RoleSummary[] = [
  { id: 'swe', name: 'Software Engineer', description: '', packageIds: ['coding', 'planning'] },
  { id: 'researcher', name: 'Researcher', description: '', packageIds: ['research', 'planning'] },
];
const PACKAGES: PackageSummary[] = [
  { id: 'core', name: 'Core', description: '', inclusion: 'default', advise: true, toolRefs: [] },
  {
    id: 'coa-orientation',
    name: 'coa orientation',
    description: '',
    inclusion: 'default',
    advise: true,
    toolRefs: [],
  },
  { id: 'coding', name: 'Coding', description: '', inclusion: 'opt-in', toolRefs: [] },
  { id: 'planning', name: 'Planning', description: '', inclusion: 'opt-in', toolRefs: [] },
  { id: 'research', name: 'Research', description: '', inclusion: 'opt-in', toolRefs: [] },
];

const stateWith = (
  agents: ConsoleState['data']['agents'],
  ui: Partial<ConsoleState['ui']> = {},
  actions: StateOverrides['actions'] = {},
): ConsoleState => makeState({ data: { agents }, ui, actions });

/** The console state a ready agents editor renders from — pass to `AgentsSurface`. */
const readyState = (
  ui: Partial<ConsoleState['ui']> = {},
  actions: StateOverrides['actions'] = {},
) => stateWith({ status: 'ok', value: MOCK_AGENTS }, ui, actions);

/** The derived vm — for assertions that inspect `selectAgentsVm`'s output directly. */
const ready = (ui: Partial<ConsoleState['ui']> = {}, actions: StateOverrides['actions'] = {}) =>
  selectAgentsVm(readyState(ui, actions));

/** `readyState`, plus a resolved model catalogue — the selected agent (reviewer, on
 *  `sonnet`) needs its model actually IN `data.models` for the reasoning ladder to
 *  have anything to render: an unresolved model offers no ladder at all (it mirrors
 *  the chat composer's own seam, which never fakes one either). */
const readyStateWithModels = (): ConsoleState =>
  makeState({
    data: { agents: { status: 'ok', value: MOCK_AGENTS }, models: { status: 'ok', value: MODELS } },
  });

describe('selectAgentsVm', () => {
  it('passes loading/error through and maps no agents to empty', () => {
    expect(selectAgentsVm(stateWith({ status: 'loading' }))).toEqual({ status: 'loading' });
    expect(selectAgentsVm(stateWith({ status: 'error', message: 'x' }))).toMatchObject({
      status: 'error',
    });
    expect(selectAgentsVm(stateWith({ status: 'ok', value: [] }))).toMatchObject({
      status: 'empty',
    });
  });

  it('opens on the selected agent, falling back to the first', () => {
    const vm = ready();
    if (vm.status === 'ready') expect(vm.selected.ref).toBe('roles/reviewer');
    const picked = ready({ selectedAgentRef: 'personal/scratch-helper' });
    if (picked.status === 'ready') expect(picked.selected.ref).toBe('personal/scratch-helper');
  });
});

describe('matchesAgent', () => {
  it('matches on the agent name', () => {
    expect(matchesAgent(MOCK_AGENTS[0]!, MOCK_AGENTS[0]!.name.slice(0, 3), [])).toBe(true);
  });

  it('matches on the model, so a backend name finds its agents', () => {
    const a = { ...MOCK_AGENTS[0]!, model: 'claude-opus-5' };
    expect(matchesAgent(a, 'opus', [])).toBe(true);
  });

  it('matches on an assigned role’s name, resolved through the catalogue', () => {
    const a = { ...MOCK_AGENTS[0]!, roles: ['swe'] };
    expect(matchesAgent(a, 'software engineer', ROLES)).toBe(true);
  });

  it('rejects a query that matches nothing', () => {
    expect(matchesAgent(MOCK_AGENTS[0]!, 'zzzz', [])).toBe(false);
  });

  it('matches everything on an empty (whitespace) query', () => {
    expect(matchesAgent(MOCK_AGENTS[0]!, '   ', [])).toBe(true);
  });
});

describe('AgentsSurface', () => {
  // One surface per test: every mounted surface reads the same slice, so seeding a second
  // state inside one test would repaint the first render too and double every match.
  it('skeletons while loading', () => {
    seedState(stateWith({ status: 'loading' }));
    const { container } = render(<AgentsSurface />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows a read error inline', () => {
    seedState(stateWith({ status: 'error', message: 'daemon down' }));
    render(<AgentsSurface />);
    expect(screen.getByRole('alert')).toHaveTextContent('daemon down');
  });

  it('lists every agent beside the detail on a wide pane', () => {
    seedState(readyState());
    render(<AgentsSurface />);
    // Scoped to the list: the selected agent's name ALSO shows in the detail heading
    // beside it, so a global query would find two matches for that one agent.
    const list = screen.getByRole('list', { name: 'Agents' });
    for (const a of MOCK_AGENTS) expect(within(list).getByText(a.name)).toBeInTheDocument();
  });

  it('teaches the surface when there are no agents', () => {
    seedState(makeState({ data: { agents: { status: 'ok', value: [] } } }));
    render(<AgentsSurface />);
    expect(screen.getByText('No agents yet')).toBeInTheDocument();
  });

  it('surfaces a read failure as an alert', () => {
    seedState(makeState({ data: { agents: { status: 'error', message: 'daemon is down' } } }));
    render(<AgentsSurface />);
    expect(screen.getByRole('alert')).toHaveTextContent('daemon is down');
  });

  it('filters the list from the strip query', async () => {
    useAgentsUi.setState({ query: '' });
    const user = userEvent.setup();
    seedState(readyState());
    render(<AgentsSurface />);
    await user.type(screen.getByRole('searchbox', { name: 'Filter agents' }), MOCK_AGENTS[0]!.name);
    // Scoped to the list for the same reason as above: the matched agent is also the
    // selected one, so its name shows a second time in the detail heading.
    const list = screen.getByRole('list', { name: 'Agents' });
    expect(within(list).getByText(MOCK_AGENTS[0]!.name)).toBeInTheDocument();
    expect(within(list).queryByText(MOCK_AGENTS[1]!.name)).not.toBeInTheDocument();
  });

  it('empty state offers creation', async () => {
    const createAgent = vi.fn();
    seedState(stateWith({ status: 'ok', value: [] }, {}, { createAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: /^new agent$/i }));
    expect(createAgent).toHaveBeenCalledExactlyOnceWith('project');
  });

  it('selects an agent from the list', async () => {
    const selectAgent = vi.fn();
    seedState(readyState({}, { selectAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'tdd-implementer' }));
    expect(selectAgent).toHaveBeenCalledExactlyOnceWith('roles/tdd-implementer');
  });

  it('renames in place through the identity header', async () => {
    const updateAgent = vi.fn();
    seedState(readyState({}, { updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: /Rename Agent name/ }));
    const input = screen.getByRole('textbox', { name: 'Agent name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'sec-reviewer{Enter}');
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer', {
      name: 'sec-reviewer',
    });
  });

  it('commits a rename on blur too, not only Enter — clicking away must not silently discard it', async () => {
    const updateAgent = vi.fn();
    seedState(readyState({}, { updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: /Rename Agent name/ }));
    const input = screen.getByRole('textbox', { name: 'Agent name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'sec-reviewer');
    // Clicking elsewhere blurs the field without pressing Enter.
    await userEvent.click(document.body);
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer', {
      name: 'sec-reviewer',
    });
  });

  it('changes the identity color through the chip popover', async () => {
    const updateAgent = vi.fn();
    seedState(readyState({}, { updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: /change icon and color/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'coral' }));
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer', { color: 'coral' });
  });

  it('shows the scope badge and ref path', () => {
    seedState(readyState());
    render(<AgentsSurface />);
    expect(screen.getByText('Project')).toBeTruthy();
    expect(screen.getByText('roles/reviewer')).toBeTruthy();
  });

  it('deleting a project agent requires typing its name', async () => {
    const deleteAgent = vi.fn();
    seedState(readyState({}, { deleteAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent actions' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete…' }));
    const confirm = await screen.findByRole('button', { name: /^delete agent$/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Agent name' }), 'reviewer');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(deleteAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer');
  });

  it('pins from the overflow menu', async () => {
    const togglePinAgent = vi.fn();
    seedState(readyState({}, { togglePinAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent actions' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    expect(togglePinAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer');
  });

  /** The console state a ready agents editor renders from, with the role/package
   *  catalogue loaded — pass to `AgentsSurface`. */
  const withCatalogueState = (
    agents: AgentSummary[],
    actions: StateOverrides['actions'] = {},
  ): ConsoleState =>
    makeState({
      data: {
        agents: { status: 'ok', value: agents },
        roles: { status: 'ok', value: ROLES },
        packages: { status: 'ok', value: PACKAGES },
      },
      actions,
    });

  it('lists the agent’s selected roles and the resolved package set, each showing how it got there', () => {
    seedState(withCatalogueState(MOCK_AGENTS));
    render(<AgentsSurface />);
    expect(screen.getByText('Roles')).toBeTruthy();
    // reviewer runs as the researcher role — it shows inline as added; swe isn't
    // selected, so — per the redesign — it has no row here at all (only the picker).
    expect(screen.getByRole('checkbox', { name: 'Researcher' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByRole('checkbox', { name: 'Software Engineer' })).not.toBeInTheDocument();
    // core is a default, research comes from the researcher role — both inherited.
    const core = screen.getByRole('checkbox', { name: 'Core' });
    expect(core).toHaveAttribute('aria-checked', 'mixed');
    // Its meta names WHY it's here — the `'default'` sentinel `membershipSource` returns,
    // capitalised at render (not lowercase "default"; capitalize() is what does that).
    expect(within(core).getByText('Default')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Research' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
    // coding isn't in the resolved set, so it has no row here either.
    expect(screen.queryByRole('checkbox', { name: 'Coding' })).not.toBeInTheDocument();
  });

  it('orders context rows inherited, then added, then excluded — not raw insertion order', () => {
    // `core` is a default (inherited) that the agent ALSO opted into explicitly via
    // `packageIds`, which — per `packageMembership` — reads as `added`, not `inherited`,
    // even though it lands in the resolver's `included` set FIRST (defaults are collected
    // before opt-ins). Left unsorted, that insertion order would put Core ahead of the
    // (purely default) coa-orientation row — the wrong read order. `coding` is excluded
    // outright. Only `MEMBERSHIP_RANK`'s sort produces the right sequence.
    const agent: AgentSummary = {
      ref: 'roles/order-check',
      name: 'order-check',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      roles: [],
      packageIds: ['core'],
      exclude: ['coding'],
    };
    seedState(withCatalogueState([agent]));
    render(<AgentsSurface />);
    const names = screen.getAllByRole('checkbox').map((el) => el.getAttribute('aria-label'));
    expect(names).toEqual(['coa orientation', 'Core', 'Coding']);
  });

  it('unions two selected roles’ packages', () => {
    const agent: AgentSummary = {
      ref: 'roles/x',
      name: 'x',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      roles: ['swe', 'researcher'],
    };
    seedState(withCatalogueState([agent]));
    render(<AgentsSurface />);
    expect(screen.getByRole('checkbox', { name: 'Software Engineer' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Researcher' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // swe brings in coding+planning, researcher brings in research+planning — union of both.
    expect(screen.getByRole('checkbox', { name: 'Coding' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
    expect(screen.getByRole('checkbox', { name: 'Research' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
  });

  it('adds a role through the Add Role picker, updating the agent’s role list', async () => {
    const updateAgent = vi.fn();
    const agent: AgentSummary = {
      ref: 'roles/x',
      name: 'x',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      roles: ['swe'],
    };
    seedState(withCatalogueState([agent], { updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Role' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Researcher' }));
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/x', {
      roles: ['swe', 'researcher'],
    });
  });

  it('deselecting the only role leaves an empty selection with no placeholder artifact', async () => {
    const updateAgent = vi.fn();
    const agent: AgentSummary = {
      ref: 'roles/x',
      name: 'x',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      roles: ['swe'],
    };
    seedState(withCatalogueState([agent], { updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Software Engineer' }));
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/x', { roles: [] });
    expect(screen.queryByText(/None/i)).toBeNull();
    expect(screen.queryByText(/Select…/i)).toBeNull();
  });

  it('toggles an off package on through the Add Context picker (adds a user opt-in)', async () => {
    const updateAgent = vi.fn();
    seedState(withCatalogueState(MOCK_AGENTS, { updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Context' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Coding' }));
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer', {
      packageIds: ['coding'],
    });
  });

  it('keeps an excluded package visible in the agent rather than hiding it', () => {
    const agents = [{ ...MOCK_AGENTS[0]!, exclude: ['core'] }];
    seedState(
      makeState({
        data: {
          agents: { status: 'ok', value: agents },
          packages: { status: 'ok', value: PKGS },
          roles: { status: 'ok', value: [] },
        },
        ui: { selectedAgentRef: agents[0]!.ref },
      }),
    );
    render(<AgentsSurface />);
    expect(screen.getByRole('checkbox', { name: 'Core' })).toHaveAttribute('aria-checked', 'false');
  });

  it('nudges when an advised package is excluded', () => {
    const agent: AgentSummary = {
      ref: 'roles/x',
      name: 'x',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      roles: ['researcher'],
      exclude: ['core'],
    };
    seedState(withCatalogueState([agent]));
    const { container } = render(<AgentsSurface />);
    expect(container.textContent).toContain('Recommended: Core');
  });

  it('states the permissive floor when no roles are selected, rendering no tool count', () => {
    // No roles ⇒ createRegistryAssemblePieces never reaches the package union at all —
    // it returns the permissive floor (pass-through floor). `core` is still a default
    // package here (toolRefs: ['Read']), so a naive union would wrongly claim "1 tool".
    const agent: AgentSummary = {
      ref: 'roles/permissive',
      name: 'permissive',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      roles: [],
    };
    seedState(
      makeState({
        data: {
          agents: { status: 'ok', value: [agent] },
          packages: { status: 'ok', value: PKGS },
          roles: { status: 'ok', value: [] },
        },
      }),
    );
    render(<AgentsSurface />);
    const reach = screen.getByRole('region', { name: 'Reach' });
    expect(
      within(reach).getByText('This agent reaches every tool the backend offers.'),
    ).toBeInTheDocument();
    // The count would render as "N tool(s)" — assert that string shape is absent, not
    // just that a particular number is missing, so reinstating the header
    // unconditionally would fail this.
    expect(within(reach).queryByText(/\d+\s+tools?/)).not.toBeInTheDocument();
  });

  it('enumerates the reached tool union once a role is selected', () => {
    const roles: RoleSummary[] = [
      { id: 'swe', name: 'Software Engineer', description: '', packageIds: ['coding'] },
    ];
    const agent: AgentSummary = {
      ref: 'roles/scoped',
      name: 'scoped',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      roles: ['swe'],
    };
    seedState(
      makeState({
        data: {
          agents: { status: 'ok', value: [agent] },
          packages: { status: 'ok', value: PKGS },
          roles: { status: 'ok', value: roles },
        },
      }),
    );
    render(<AgentsSurface />);
    const reach = screen.getByRole('region', { name: 'Reach' });
    // core (default) contributes Read; coding (via the selected role) contributes Edit.
    // No package here declares mcpServers, and the count is tools-only regardless (the
    // runtime doesn't realize MCP grants yet — see ReachSection's own comment).
    expect(within(reach).getByText('2 tools')).toBeInTheDocument();
    expect(within(reach).getByText('Read')).toBeInTheDocument();
    expect(within(reach).getByText('Edit')).toBeInTheDocument();
  });

  it('never reports an MCP count, even when an included package declares mcpServers — the runtime does not realize the grant yet', () => {
    const roles: RoleSummary[] = [
      { id: 'swe', name: 'Software Engineer', description: '', packageIds: ['coding'] },
    ];
    const pkgsWithMcp: PackageSummary[] = [
      ...PKGS,
      {
        id: 'connected',
        name: 'Connected',
        description: '',
        inclusion: 'default',
        toolRefs: [],
        mcpServers: ['fs'],
      },
    ];
    const agent: AgentSummary = {
      ref: 'roles/scoped',
      name: 'scoped',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      roles: ['swe'],
    };
    seedState(
      makeState({
        data: {
          agents: { status: 'ok', value: [agent] },
          packages: { status: 'ok', value: pkgsWithMcp },
          roles: { status: 'ok', value: roles },
        },
      }),
    );
    render(<AgentsSurface />);
    const reach = screen.getByRole('region', { name: 'Reach' });
    expect(within(reach).queryByText(/MCP/)).not.toBeInTheDocument();
    expect(within(reach).getByText('2 tools')).toBeInTheDocument();
  });

  it('wears the reasoning ladder rather than a separate on/off control', () => {
    seedState(readyStateWithModels());
    render(<AgentsSurface />);
    expect(screen.getByRole('slider', { name: 'Reasoning effort' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Reasoning' })).not.toBeInTheDocument();
  });

  it('offers the model list through one searchable control', () => {
    seedState(readyStateWithModels());
    render(<AgentsSurface />);
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument();
  });

  it('marks a Claude model with the vendor harness coa layers its prompt onto', () => {
    const claudeModel: ModelDescriptor = {
      id: 'opus-claude',
      provider: 'claude',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
    };
    const agent: AgentSummary = {
      ref: 'roles/x',
      name: 'x',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      model: 'opus-claude',
    };
    seedState(
      makeState({
        data: {
          agents: { status: 'ok', value: [agent] },
          models: { status: 'ok', value: [claudeModel] },
        },
      }),
    );
    render(<AgentsSurface />);
    // Two different questions, both answered by Claude's logo here: the HARNESS mark
    // beside the field (what runs it), and the BACKEND mark on the picker's trigger
    // (where the model comes from).
    const marks = screen.getAllByRole('img', { name: 'Claude' });
    expect(marks.some((m) => m.closest('[tabindex]') !== null)).toBe(true);
    expect(marks.some((m) => m.closest('[role="combobox"]') !== null)).toBe(true);
  });

  it('marks a pure-API model with coa’s own scaffold mark, not a vendor logo', () => {
    const agent: AgentSummary = {
      ref: 'roles/x',
      name: 'x',
      description: 'd',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
      model: LONGCAT.id,
      provider: 'longcat',
    };
    seedState(
      makeState({
        data: {
          agents: { status: 'ok', value: [agent] },
          models: { status: 'ok', value: [LONGCAT] },
        },
      }),
    );
    render(<AgentsSurface />);
    expect(screen.getByRole('img', { name: 'coa' })).toBeInTheDocument();
  });
});

describe('AgentsSurface — a built-in agent is read-only', () => {
  // A built-in agent ships in code (no file backs it) — the daemon refuses a
  // save/delete against it, so the editor renders it read-only.
  const BUILTIN_AGENT: AgentSummary = {
    ref: 'general-purpose',
    name: 'General purpose',
    description: 'A general worker.',
    icon: 'bot',
    color: 'slate',
    scope: 'builtin',
  };

  it('shows the Built-in badge and renders the name with no rename affordance', () => {
    seedState(stateWith({ status: 'ok', value: [BUILTIN_AGENT] }));
    render(<AgentsSurface />);
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rename Agent name/ })).not.toBeInTheDocument();
    // Shows in both its list row and the (only) editor's heading — never zero.
    expect(screen.getAllByText('General purpose').length).toBeGreaterThan(0);
  });

  it('omits the icon/color popover trigger', () => {
    seedState(stateWith({ status: 'ok', value: [BUILTIN_AGENT] }));
    render(<AgentsSurface />);
    expect(screen.queryByRole('button', { name: /change icon and color/ })).not.toBeInTheDocument();
  });

  it('omits the Delete and Move menu items', async () => {
    seedState(stateWith({ status: 'ok', value: [BUILTIN_AGENT] }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent actions' }));
    expect(screen.queryByRole('button', { name: 'Delete…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to/ })).not.toBeInTheDocument();
  });

  it('duplicating a built-in seeds a project agent, not a "builtin"-scoped one', async () => {
    const createAgent = vi.fn();
    seedState(stateWith({ status: 'ok', value: [BUILTIN_AGENT] }, {}, { createAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent actions' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    expect(createAgent).toHaveBeenCalledExactlyOnceWith('project');
  });

  it('renders the description as plain text, with no edit affordance', () => {
    seedState(stateWith({ status: 'ok', value: [BUILTIN_AGENT] }));
    render(<AgentsSurface />);
    expect(screen.getByText('A general worker.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Edit agent description/ }),
    ).not.toBeInTheDocument();
  });

  // Regression guard: FINDING 1 was that `AgentList` only ever built a `pinned`,
  // `project`, and `personal` group — a `scope: 'builtin'` agent matched none of
  // them and rendered nowhere in a list that had ANY other agent in it. A fixture
  // seeded with ONLY the builtin agent can't catch this (it trivially becomes
  // `agents[0]`, the editor's arbitrary fallback) — this one seeds a MIXED list.
  it('shows up in its own group alongside project/personal agents, and stays selectable', async () => {
    const selectAgent = vi.fn();
    seedState(
      stateWith({ status: 'ok', value: [MOCK_AGENTS[0]!, BUILTIN_AGENT] }, {}, { selectAgent }),
    );
    render(<AgentsSurface />);
    expect(screen.getByRole('group', { name: 'Built-in agents' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Project agents' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Agents' });
    const row = within(list).getByRole('button', { name: BUILTIN_AGENT.name });
    expect(row).toBeInTheDocument();
    await userEvent.click(row);
    expect(selectAgent).toHaveBeenCalledExactlyOnceWith(BUILTIN_AGENT.ref);
  });
});

describe('AgentsSurface — the description field', () => {
  it('renders the current description', () => {
    seedState(readyState());
    render(<AgentsSurface />);
    expect(screen.getByText(MOCK_AGENTS[0]!.description)).toBeInTheDocument();
  });

  it('edits in place, committing on Enter', async () => {
    const updateAgent = vi.fn();
    seedState(readyState({}, { updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: /Edit agent description/ }));
    const input = screen.getByRole('textbox', { name: 'Agent description' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Finds and fixes flaky tests.{Enter}');
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer', {
      description: 'Finds and fixes flaky tests.',
    });
  });

  it('degrades an emptied draft by reverting instead of saving — the schema requires a non-empty description', async () => {
    const updateAgent = vi.fn();
    seedState(readyState({}, { updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: /Edit agent description/ }));
    const input = screen.getByRole('textbox', { name: 'Agent description' });
    await userEvent.clear(input);
    await userEvent.click(document.body);
    expect(updateAgent).not.toHaveBeenCalled();
    // Reverted to the original text, not left blank.
    expect(screen.getByText(MOCK_AGENTS[0]!.description)).toBeInTheDocument();
  });
});

describe('AgentsSurface — load diagnostics', () => {
  it('surfaces a diagnostic reaching the renderer, naming the affected ref and the problem', () => {
    const diagnostic: AgentDiagnostic = {
      scope: 'personal',
      ref: 'broken-agent',
      path: '/home/.coa/agents/broken-agent.yaml',
      problem: 'invalid',
      detail: 'missing required field: description',
    };
    seedState(
      makeState({
        data: { agents: { status: 'ok', value: MOCK_AGENTS }, agentDiagnostics: [diagnostic] },
      }),
    );
    render(<AgentsSurface />);
    expect(screen.getByText(/broken-agent/)).toBeInTheDocument();
    expect(screen.getByText(/invalid file/)).toBeInTheDocument();
    expect(screen.getByText(/missing required field: description/)).toBeInTheDocument();
  });

  it('renders nothing when there are no diagnostics', () => {
    seedState(
      makeState({
        data: { agents: { status: 'ok', value: MOCK_AGENTS }, agentDiagnostics: [] },
      }),
    );
    render(<AgentsSurface />);
    expect(screen.queryByText(/invalid file/)).not.toBeInTheDocument();
  });
});

describe('AgentsStrip', () => {
  it('names the surface and counts the agents', () => {
    seedState(readyState());
    render(<AgentsStrip />);
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText(`${MOCK_AGENTS.length} agents`)).toBeInTheDocument();
  });

  it('leaves the filter to the list it filters, keeping the strip to surface chrome', () => {
    seedState(readyState());
    render(<AgentsStrip />);
    expect(screen.queryByRole('searchbox', { name: 'Filter agents' })).not.toBeInTheDocument();
  });

  it('carries a New Agent action wired to the real create action', async () => {
    const createAgent = vi.fn();
    seedState(readyState({}, { createAgent }));
    render(<AgentsStrip />);
    await userEvent.click(screen.getByRole('button', { name: /new agent/i }));
    expect(createAgent).toHaveBeenCalledExactlyOnceWith('project');
  });

  it('shows the back control and the open agent’s name once a narrow drill-down is open', () => {
    seedState(readyState({ selectedAgentRef: 'roles/tdd-implementer' }));
    useAgentsUi.setState({ narrow: true, open: true });
    render(<AgentsStrip />);
    expect(screen.getByRole('button', { name: /‹ agents/i })).toBeInTheDocument();
    expect(screen.getByText('tdd-implementer')).toBeInTheDocument();
  });

  it('keeps New Agent reachable from inside the drill-down — it acts on the surface', () => {
    seedState(readyState({ selectedAgentRef: 'roles/tdd-implementer' }));
    useAgentsUi.setState({ narrow: true, open: true });
    render(<AgentsStrip />);
    expect(screen.getByRole('button', { name: /new agent/i })).toBeInTheDocument();
  });
});

describe('AgentsSurface — the filter', () => {
  it('renders the filter on the list as a searchbox named Filter agents', () => {
    seedState(readyState());
    render(<AgentsSurface />);
    expect(screen.getByRole('searchbox', { name: 'Filter agents' })).toBeInTheDocument();
  });

  it('bumping filterFocus (ctrl+f, via keys.tsx) moves DOM focus into the filter', () => {
    seedState(readyState());
    render(<AgentsSurface />);
    const input = screen.getByRole('searchbox', { name: 'Filter agents' });
    expect(input).not.toHaveFocus();
    act(() => useAgentsUi.getState().focusFilter());
    expect(input).toHaveFocus();
  });

  it('drops the filter in the drill-down, where there is no list to filter', async () => {
    measuredNarrow = true;
    seedState(readyState());
    render(<AgentsSurface />);
    // Becoming narrow lands on the list, so the filter is still there…
    expect(screen.getByRole('searchbox', { name: 'Filter agents' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'reviewer' }));
    // …and goes with the list column once the drill-down swaps it for the detail.
    // `waitFor`: AnimatePresence keeps the outgoing pane mounted for its exit.
    await waitFor(() =>
      expect(screen.queryByRole('searchbox', { name: 'Filter agents' })).not.toBeInTheDocument(),
    );
  });

  it('centers and caps the filter once the list has the whole pane', () => {
    measuredNarrow = true;
    seedState(readyState());
    render(<AgentsSurface />);
    const field = screen.getByRole('searchbox', { name: 'Filter agents' });
    expect(field.parentElement?.className).toContain('max-w-80');
  });
});

describe('AgentsSurface — containment and shape', () => {
  /** Roles and packages must be present for every section to render at all. */
  const catalogueState = (
    ui: Partial<ConsoleState['ui']> = {},
    actions: StateOverrides['actions'] = {},
  ): ConsoleState =>
    makeState({
      data: {
        agents: { status: 'ok', value: MOCK_AGENTS },
        roles: { status: 'ok', value: ROLES },
        packages: { status: 'ok', value: PACKAGES },
      },
      ui,
      actions,
    });

  it('contains each concern in its own named region', () => {
    seedState(catalogueState());
    render(<AgentsSurface />);
    for (const name of ['Runs on', 'Roles', 'Context', 'Reach']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('lays the row list out to fill the width it is given', () => {
    seedState(catalogueState());
    const { container } = render(<AgentsSurface />);
    const grid = container.querySelector('[data-row-grid]');
    expect(grid?.className).toContain('auto-fit');
  });

  it('renames in the same face it displays', async () => {
    const user = userEvent.setup();
    seedState(catalogueState());
    render(<AgentsSurface />);
    const display = screen.getByRole('button', { name: /^Rename Agent name/ });
    expect(display.className).toContain('text-body');
    expect(display.className).toContain('font-semibold');
    await user.click(display);
    const field = screen.getByRole('textbox', { name: 'Agent name' });
    // The edit face must NOT fall back to the shared mono/code input skin.
    expect(field.className).not.toContain('font-mono');
    expect(field.className).not.toContain('text-code');
    expect(field.className).toContain('text-body');
    expect(field.className).toContain('font-semibold');
  });

  it('offers the pin as a pressed control rather than a bare marker', async () => {
    const user = userEvent.setup();
    const togglePinAgent = vi.fn();
    seedState(
      catalogueState({ settings: { pinnedAgents: ['roles/reviewer'] } }, { togglePinAgent }),
    );
    render(<AgentsSurface />);
    const pin = screen.getByRole('button', { name: 'Unpin agent' });
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    await user.click(pin);
    expect(togglePinAgent).toHaveBeenCalledWith('roles/reviewer');
    // The pill it replaces is gone.
    expect(screen.queryByText('Pinned')).toBeNull();
  });

  it('still offers the control when the agent is not pinned', () => {
    seedState(catalogueState({ settings: { pinnedAgents: [] } }));
    render(<AgentsSurface />);
    expect(screen.getByRole('button', { name: 'Pin agent' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('AgentEditor — the skills section', () => {
  const skillAgent: AgentSummary = {
    ref: 'roles/writer',
    scope: 'project',
    name: 'Writer',
    description: 'Writes things down.',
    icon: 'pen',
    color: 'sky',
    skills: [
      { name: 'commits', delivery: 'auto' },
      { name: 'ghost', delivery: 'disclosure' },
    ],
  };

  beforeEach(() => {
    useLibraryStore.setState({
      invocable: {
        status: 'ok',
        value: [
          { name: 'commits', description: 'Commit style', scope: 'project' },
          { name: 'review', description: 'Review checklist', scope: 'personal' },
        ],
      },
      // Silence the surface's mount read — these tests drive the store state directly.
      hydrate: vi.fn().mockResolvedValue(undefined),
    });
  });

  const skillState = (actions: StateOverrides['actions'] = {}): ConsoleState =>
    stateWith({ status: 'ok', value: [skillAgent] }, {}, actions);

  it('lists configured skills with delivery, marking one the library no longer serves', () => {
    seedState(skillState());
    render(<AgentsSurface />);
    const section = screen.getByRole('region', { name: 'Skills' });
    const commits = within(section).getByRole('listitem', { name: 'commits' });
    expect(within(commits).getByText('Commit style')).toBeInTheDocument();
    expect(
      within(commits).getByRole('button', { name: 'Auto', pressed: true }),
    ).toBeInTheDocument();
    const ghost = within(section).getByRole('listitem', { name: 'ghost' });
    expect(within(ghost).getByText('Not in the library')).toBeInTheDocument();
    expect(
      within(ghost).getByRole('button', { name: 'On demand', pressed: true }),
    ).toBeInTheDocument();
  });

  it('flips a skill delivery through updateAgent', async () => {
    const updateAgent = vi.fn();
    seedState(skillState({ updateAgent }));
    render(<AgentsSurface />);
    const commits = within(screen.getByRole('region', { name: 'Skills' })).getByRole('listitem', {
      name: 'commits',
    });
    await userEvent.click(within(commits).getByRole('button', { name: 'On demand' }));
    expect(updateAgent).toHaveBeenCalledWith('roles/writer', {
      skills: [
        { name: 'commits', delivery: 'disclosure' },
        { name: 'ghost', delivery: 'disclosure' },
      ],
    });
  });

  it('adds a skill from the library picker (auto delivery is the default)', async () => {
    const updateAgent = vi.fn();
    seedState(skillState({ updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Skill' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'review' }));
    expect(updateAgent).toHaveBeenCalledWith('roles/writer', {
      skills: [
        { name: 'commits', delivery: 'auto' },
        { name: 'ghost', delivery: 'disclosure' },
        { name: 'review', delivery: 'auto' },
      ],
    });
  });

  it('removes a configured skill', async () => {
    const updateAgent = vi.fn();
    seedState(skillState({ updateAgent }));
    render(<AgentsSurface />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove skill: ghost' }));
    expect(updateAgent).toHaveBeenCalledWith('roles/writer', {
      skills: [{ name: 'commits', delivery: 'auto' }],
    });
  });

  it('states an empty library instead of offering an empty picker', () => {
    useLibraryStore.setState({ invocable: { status: 'ok', value: [] } });
    seedState(skillState());
    render(<AgentsSurface />);
    expect(
      screen.getByText('No skills in the library — link one on the Library surface'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Skill' })).toBeNull();
  });

  it('names a FAILED library read, and never marks a configured skill absent on it', () => {
    // The regression: an unreadable library left the footer on "Reading the library…"
    // forever AND is no evidence that a configured skill is gone.
    useLibraryStore.setState({ invocable: { status: 'error', message: 'daemon unreachable' } });
    seedState(skillState());
    render(<AgentsSurface />);
    expect(screen.queryByText('Reading the library…')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('daemon unreachable');
    expect(screen.queryByText('Not in the library')).toBeNull();
  });

  it('says the library is still being read while the read is in flight', () => {
    useLibraryStore.setState({ invocable: { status: 'loading' } });
    seedState(skillState());
    render(<AgentsSurface />);
    expect(screen.getByText('Reading the library…')).toBeInTheDocument();
    expect(screen.queryByText('Not in the library')).toBeNull();
  });

  it('renders a built-in agent read-only: no picker, delivery inert, no remove', () => {
    const builtin: AgentSummary = { ...skillAgent, ref: 'builtin/writer', scope: 'builtin' };
    seedState(stateWith({ status: 'ok', value: [builtin] }));
    render(<AgentsSurface />);
    expect(screen.queryByRole('button', { name: 'Add Skill' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove skill/ })).toBeNull();
    const commits = within(screen.getByRole('region', { name: 'Skills' })).getByRole('listitem', {
      name: 'commits',
    });
    expect(within(commits).getByRole('button', { name: 'Auto' })).toBeDisabled();
  });
});

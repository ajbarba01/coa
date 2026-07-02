// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  agentsPanel,
  buildAgentPickerGroups,
  clampReasoning,
  modelLabel,
  modelReasoningCaps,
  pickableModels,
  selectAgentsVm,
} from './AgentsPanel.js';
import { makeState, type StateOverrides } from './fixtures.js';
import { MOCK_AGENTS } from './mockAgents.js';
import type { ModelDescriptor } from '@coa/console-viewmodel';
import type { ConsoleState } from './state.js';

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
const DEFAULT_MODEL: ModelDescriptor = {
  id: 'default',
  displayName: 'Default (recommended)',
  description: 'Sonnet 4.6 · Efficient for routine tasks',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  supportsAdaptiveThinking: true,
};
const MODELS = [DEFAULT_MODEL, SONNET, OPUS, HAIKU];
const FULL_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'];

describe('modelLabel', () => {
  it('shows the version from the description when the name is already in it', () => {
    expect(modelLabel(OPUS)).toBe('Opus 4.8');
    expect(modelLabel(SONNET)).toBe('Sonnet 4.6');
    expect(modelLabel(HAIKU)).toBe('Haiku 4.5');
    expect(modelLabel({ id: 'claude-fable-5[1m]', displayName: 'Fable', description: 'Fable 5 · Most capable' })).toBe(
      'Fable 5',
    );
  });

  it('keeps a distinct display name alongside the version (the default alias)', () => {
    expect(modelLabel(DEFAULT_MODEL)).toBe('Default (recommended) · Sonnet 4.6');
  });

  it('falls back to the display name, then the id, when there is no description', () => {
    expect(modelLabel({ id: 'x', displayName: 'X' })).toBe('X');
    expect(modelLabel({ id: 'raw-id' })).toBe('raw-id');
  });
});

describe('modelReasoningCaps', () => {
  it('uses the resolved model’s real effort levels and adaptive flag', () => {
    expect(modelReasoningCaps(MODELS, 'opus')).toEqual({
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      includeBudget: true,
    });
    expect(modelReasoningCaps(MODELS, 'sonnet')).toEqual({
      efforts: ['low', 'medium', 'high', 'max'],
      includeBudget: true,
    });
  });

  it('shows NO effort options for a resolved model that supports none (Haiku)', () => {
    expect(modelReasoningCaps(MODELS, 'haiku')).toEqual({ efforts: [], includeBudget: false });
  });

  it('falls back to the full ladder while the model list is still loading', () => {
    expect(modelReasoningCaps([], 'opus')).toEqual({ efforts: FULL_LADDER, includeBudget: true });
  });

  it('falls back to the full ladder for an unknown model id (never cages the choice)', () => {
    expect(modelReasoningCaps(MODELS, 'claude-opus-4-8')).toEqual({
      efforts: FULL_LADDER,
      includeBudget: true,
    });
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
  const opusCaps = { efforts: ['low', 'medium', 'high', 'xhigh', 'max'] as const, includeBudget: true };
  const sonnetCaps = { efforts: ['low', 'medium', 'high', 'max'] as const, includeBudget: true };
  const haikuCaps = { efforts: [] as const, includeBudget: false };

  it('keeps a reasoning the new model still supports', () => {
    const r = { mode: 'effort', effort: 'high' } as const;
    expect(clampReasoning(r, { ...sonnetCaps, efforts: [...sonnetCaps.efforts] })).toBe(r);
  });

  it('drops an effort the new model does not offer (xhigh → default)', () => {
    const r = { mode: 'effort', effort: 'xhigh' } as const;
    expect(clampReasoning(r, { ...sonnetCaps, efforts: [...sonnetCaps.efforts] })).toBeUndefined();
  });

  it('drops all effort/budget for a model with no reasoning (Haiku)', () => {
    expect(clampReasoning({ mode: 'effort', effort: 'low' }, { ...haikuCaps, efforts: [] })).toBeUndefined();
    expect(
      clampReasoning({ mode: 'budget', budgetTokens: 8000 }, { ...haikuCaps, efforts: [] }),
    ).toBeUndefined();
  });

  it('keeps budget when the new model supports adaptive thinking, drops it otherwise', () => {
    const r = { mode: 'budget', budgetTokens: 8000 } as const;
    expect(clampReasoning(r, { ...opusCaps, efforts: [...opusCaps.efforts] })).toBe(r);
    expect(clampReasoning(r, { efforts: [...opusCaps.efforts], includeBudget: false })).toBeUndefined();
  });

  it('always keeps off and undefined (default)', () => {
    const off = { mode: 'off' } as const;
    expect(clampReasoning(off, { ...haikuCaps, efforts: [] })).toBe(off);
    expect(clampReasoning(undefined, { ...opusCaps, efforts: [...opusCaps.efforts] })).toBeUndefined();
  });
});

const AgentsView = agentsPanel.render;
const host = {
  title: 'Agents',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

const stateWith = (
  agents: ConsoleState['data']['agents'],
  ui: Partial<ConsoleState['ui']> = {},
  actions: StateOverrides['actions'] = {},
): ConsoleState => makeState({ data: { agents }, ui, actions });

const ready = (ui: Partial<ConsoleState['ui']> = {}, actions: StateOverrides['actions'] = {}) =>
  selectAgentsVm(stateWith({ status: 'ok', value: MOCK_AGENTS }, ui, actions));

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

describe('buildAgentPickerGroups', () => {
  it('groups pinned, then project, then personal, then the create row', () => {
    const groups = buildAgentPickerGroups(MOCK_AGENTS, ['roles/refactor-bot'], 'roles/reviewer');
    expect(groups.map((g) => g.id)).toEqual(['pinned', 'project', 'personal', 'create']);
    expect(groups[0]?.options.map((o) => o.id)).toEqual(['roles/refactor-bot']);
    // a pinned agent leaves its scope group (no duplicate rows)
    expect(groups[1]?.options.map((o) => o.id)).toEqual([
      'roles/reviewer',
      'roles/tdd-implementer',
    ]);
    expect(groups[1]?.options[0]).toMatchObject({ selected: true });
    expect(groups[3]?.actions?.[0]).toMatchObject({ id: 'new-agent' });
  });
});

describe('AgentsView', () => {
  it('skeletons while loading and shows errors inline', () => {
    const { container } = render(<AgentsView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    render(<AgentsView vm={{ status: 'error', message: 'daemon down' }} host={host} />);
    expect(screen.getByText('daemon down')).toBeTruthy();
  });

  it('empty state offers creation', async () => {
    const createAgent = vi.fn();
    render(
      <AgentsView
        vm={selectAgentsVm(stateWith({ status: 'ok', value: [] }, {}, { createAgent }))}
        host={host}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'New agent' }));
    expect(createAgent).toHaveBeenCalledExactlyOnceWith('project');
  });

  it('switches agents through the picker', async () => {
    const selectAgent = vi.fn();
    render(<AgentsView vm={ready({}, { selectAgent })} host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch agent' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /tdd-implementer/ }));
    expect(selectAgent).toHaveBeenCalledExactlyOnceWith('roles/tdd-implementer');
  });

  it('renames in place through the identity header', async () => {
    const updateAgent = vi.fn();
    render(<AgentsView vm={ready({}, { updateAgent })} host={host} />);
    await userEvent.click(screen.getByRole('button', { name: /Rename Agent name/ }));
    const input = screen.getByRole('textbox', { name: 'Agent name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'sec-reviewer{Enter}');
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer', {
      name: 'sec-reviewer',
    });
  });

  it('changes the identity color through the chip popover', async () => {
    const updateAgent = vi.fn();
    render(<AgentsView vm={ready({}, { updateAgent })} host={host} />);
    await userEvent.click(screen.getByRole('button', { name: /change icon and color/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'coral' }));
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer', { color: 'coral' });
  });

  it('shows the scope badge and ref path', () => {
    render(<AgentsView vm={ready()} host={host} />);
    expect(screen.getByText('Project')).toBeTruthy();
    expect(screen.getByText('roles/reviewer')).toBeTruthy();
  });

  it('deleting a project agent requires typing its name', async () => {
    const deleteAgent = vi.fn();
    render(<AgentsView vm={ready({}, { deleteAgent })} host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const confirm = await screen.findByRole('button', { name: 'Delete agent' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Agent name' }), 'reviewer');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(deleteAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer');
  });

  it('pins from the overflow menu', async () => {
    const togglePinAgent = vi.fn();
    render(<AgentsView vm={ready({}, { togglePinAgent })} host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }));
    expect(togglePinAgent).toHaveBeenCalledExactlyOnceWith('roles/reviewer');
  });
});

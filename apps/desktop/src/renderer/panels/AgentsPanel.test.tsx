// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { agentsPanel, buildAgentPickerGroups, selectAgentsVm } from './AgentsPanel.js';
import { makeState, type StateOverrides } from './fixtures.js';
import { MOCK_AGENTS } from './mockAgents.js';
import type { ConsoleState } from './state.js';

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

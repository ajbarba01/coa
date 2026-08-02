// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Combobox, filterOptions, type ComboboxOption } from './Combobox.js';

const OPTIONS: ComboboxOption[] = [
  { value: 'opus-5', label: 'Claude · Opus 5', group: 'Claude Code' },
  { value: 'sonnet-5', label: 'Claude · Sonnet 5', group: 'Claude Code' },
  { value: 'ds-v4', label: 'DeepSeek · V4 Pro', group: 'coa scaffold' },
];

describe('filterOptions', () => {
  it('matches on label, case-insensitively', () => {
    expect(filterOptions(OPTIONS, 'opus').map((o) => o.value)).toEqual(['opus-5']);
  });

  it('matches on group so a harness name finds its models', () => {
    expect(filterOptions(OPTIONS, 'scaffold').map((o) => o.value)).toEqual(['ds-v4']);
  });

  it('returns everything for an empty query', () => {
    expect(filterOptions(OPTIONS, '   ')).toHaveLength(3);
  });
});

describe('Combobox', () => {
  it('shows the selected option label on the trigger', () => {
    render(
      <Combobox
        options={OPTIONS}
        value="ds-v4"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('DeepSeek · V4 Pro');
  });

  it('filters as you type and selects with enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={onChange}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.type(screen.getByPlaceholderText('Filter models…'), 'deep');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('ds-v4');
  });

  it('ArrowDown moves the cursor down through several rows; Enter selects the one it lands on', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={onChange}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const input = screen.getByPlaceholderText('Filter models…');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    // Two steps down from the first row lands on the third (last) row.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('ds-v4');
  });

  it('ArrowUp at the top row keeps the cursor clamped instead of wrapping to the bottom', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={onChange}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const input = screen.getByPlaceholderText('Filter models…');
    // Already at the top row (cursor 0): ArrowUp must hold, not wrap to the last row.
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('opus-5');
  });

  it('renders a group header verbatim, without CapsLabel’s uppercase transform (a group can be deliberately lowercase, like the harness name "coa scaffold")', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const header = screen.getByText('coa scaffold');
    expect(header.className).not.toContain('uppercase');
  });

  it('renders a footer inside the popup when given one', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        footer={<span>Reasoning</span>}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
  });

  it('renders no footer region — and so no stray hairline — without one', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(container.querySelector('[data-combobox-footer]')).toBeNull();
  });

  it('lets the caller override the trigger text', () => {
    render(
      <Combobox
        options={OPTIONS}
        value="ds-v4"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        triggerLabel="DeepSeek · V4 Pro · think"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent(
      'DeepSeek · V4 Pro · think',
    );
  });

  it('wears the borderless chip skin on the chip variant', () => {
    render(
      <Combobox
        options={OPTIONS}
        value="ds-v4"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        variant="chip"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Model' }).className).not.toContain('border-s4');
  });

  it('says so when nothing matches instead of showing an empty popup', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.type(screen.getByPlaceholderText('Filter models…'), 'zzz');
    expect(screen.getByText('No match')).toBeInTheDocument();
  });
});

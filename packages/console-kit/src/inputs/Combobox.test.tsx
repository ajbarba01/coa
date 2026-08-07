// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('wears a leading glyph on the trigger when given one', () => {
    render(
      <Combobox
        options={OPTIONS}
        value="ds-v4"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        triggerLeading={<span role="img" aria-label="DeepSeek" />}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Model' });
    expect(within(trigger).getByRole('img', { name: 'DeepSeek' })).toBeInTheDocument();
  });

  it('anchors the popup to the trigger edge the caller names', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="ds-v4"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        align="end"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    // A trigger in a right-packed row moves its LEFT edge whenever its own label
    // changes width, so anchoring there makes the popup jump; the caller has to be
    // able to name the edge that holds still.
    const positioner = screen
      .getByRole('listbox', { name: 'Model' })
      .closest('[data-align]') as HTMLElement | null;
    expect(positioner?.dataset['align']).toBe('end');
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

  it('renders a rail of scopes and reports the one clicked', async () => {
    const onScope = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        rail={{
          label: 'Backend',
          value: 'all',
          onChange: onScope,
          items: [
            { id: 'all', label: 'All backends', leading: <span>✳</span> },
            { id: 'deepseek', label: 'DeepSeek', leading: <span>D</span> },
          ],
        }}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const rail = screen.getByRole('group', { name: 'Backend' });
    expect(within(rail).getByRole('button', { name: 'All backends' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(rail).getByRole('button', { name: 'DeepSeek' }));
    expect(onScope).toHaveBeenCalledWith('deepseek');
  });

  it('opens with the caret in the filter input, not on the rail it now sits beside', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        rail={{
          label: 'Backend',
          value: 'all',
          onChange: () => {},
          items: [
            { id: 'all', label: 'All backends', leading: <span>✳</span> },
            { id: 'deepseek', label: 'DeepSeek', leading: <span>D</span> },
          ],
        }}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    // The rail's first button is the popup's first tabbable element, so the default
    // "focus what comes first" would open onto a scope button and typing would go nowhere.
    //
    // Awaited rather than read the instant the click returns: opening a popup settles the
    // caret over two steps — the field's own open effect, then the popup's focus manager,
    // which commits on the next animation frame. Where the caret ENDS UP is the claim; which
    // of those two got there first is not, and sampling between them is what made this read
    // as intermittent.
    await waitFor(() => expect(screen.getByPlaceholderText('Filter models…')).toHaveFocus());
  });

  it('holds the list at a fixed height under a rail, so changing scope cannot resize the popup', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        rail={{
          label: 'Backend',
          value: 'all',
          onChange: () => {},
          items: [
            { id: 'all', label: 'All backends', leading: <span>✳</span> },
            { id: 'deepseek', label: 'DeepSeek', leading: <span>D</span> },
          ],
        }}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const list = screen.getByRole('listbox', { name: 'Model' });
    expect(list.className).toContain('h-64');
    expect(list.className).not.toContain('max-h-64');
  });

  it('drops the surface’s own padding under a rail, so the rail reaches both rounded ends', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
        rail={{
          label: 'Backend',
          value: 'all',
          onChange: () => {},
          items: [
            { id: 'all', label: 'All backends', leading: <span>✳</span> },
            { id: 'deepseek', label: 'DeepSeek', leading: <span>D</span> },
          ],
        }}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const surface = screen.getByRole('group', { name: 'Backend' }).parentElement?.parentElement;
    // Not "overridden" — ABSENT. Both paddings would be emitted and the cascade would
    // settle it by value order, which is not a decision anyone made.
    expect(surface?.className).toContain('rounded-r3');
    expect(surface?.className).not.toContain('py-1');
  });

  it('lets the list size to its contents without a rail, where nothing reflows it', async () => {
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
    expect(screen.getByRole('listbox', { name: 'Model' }).className).toContain('max-h-64');
  });

  it('renders no rail region without one', async () => {
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
    expect(screen.queryByRole('group')).toBeNull();
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

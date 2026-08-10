// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ModelDescriptor } from '@coa/console-viewmodel';
import { ModelPicker, modelLabel, type ModelPickerProps } from './ModelPicker.js';

const MODELS: ModelDescriptor[] = [
  { id: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6 · balanced' },
  { id: 'opus', displayName: 'Opus', description: 'Opus 4.8 · deep' },
];
// Mixed on purpose: a single-backend fixture makes a rail trivially correct and hides
// both the derivation and the one-backend degradations.
const MIXED: ModelDescriptor[] = [
  ...MODELS,
  { id: 'ds', displayName: 'V4 Pro', provider: 'deepseek' },
  { id: 'lc', displayName: 'LongCat-2.0', provider: 'longcat' },
];
const EFFORTS = [
  { value: 'none', label: 'none' },
  { value: 'think', label: 'think' },
  { value: 'ultra', label: 'ultra' },
];

/** The picker under its resting props — a component rather than a bare element so a test
 *  can re-render it with a changed model list. */
function Picker(overrides: Partial<ModelPickerProps> = {}): React.JSX.Element {
  return (
    <ModelPicker
      models={MODELS}
      value="sonnet"
      onChange={vi.fn()}
      effortOptions={EFFORTS}
      effortValue="think"
      onEffortChange={vi.fn()}
      variant="chip"
      {...overrides}
    />
  );
}

function setup(overrides: Partial<ModelPickerProps> = {}): {
  onChange: ReturnType<typeof vi.fn>;
  onEffortChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  const onEffortChange = vi.fn();
  render(Picker({ onChange, onEffortChange, ...overrides }));
  return { onChange, onEffortChange };
}

describe('ModelPicker', () => {
  it('names the model and nothing else on the chip trigger', () => {
    setup();
    const trigger = screen.getByRole('combobox', { name: 'Model' });
    expect(trigger).toHaveTextContent('Sonnet 4.6');
    // Reasoning is its own control on the shelf now, so the model chip must not
    // report a stop it does not own.
    expect(trigger).not.toHaveTextContent('think');
  });

  it('renders no reasoning surface at all as a chip, opened or closed', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
  });

  it('leaves the stop off the bordered trigger, whose ladder is already visible', () => {
    setup({ variant: 'bordered' });
    const trigger = screen.getByRole('combobox', { name: 'Model' });
    expect(trigger).toHaveTextContent('Sonnet 4.6');
    expect(trigger).not.toHaveTextContent('think');
    expect(screen.getByRole('slider', { name: 'Reasoning effort' })).toBeInTheDocument();
  });

  it('renders no reasoning control at all for a model that offers none', () => {
    setup({ variant: 'bordered', effortOptions: [] });
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
  });

  it('reports the picked model', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /Opus/ }));
    expect(onChange).toHaveBeenCalledWith('opus');
  });

  it('groups the options by backend, the same slicing the rail offers', async () => {
    const user = userEvent.setup();
    setup({ models: MIXED });
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const list = screen.getByRole('listbox', { name: 'Model' });
    expect(within(list).getByText('Claude')).toBeInTheDocument();
    expect(within(list).getByText('DeepSeek')).toBeInTheDocument();
    expect(within(list).getByText('LongCat')).toBeInTheDocument();
    // The harness is a different question ("what actually runs this"), and the agent
    // editor's Runs-on field is the one place that asks it.
    expect(within(list).queryByText('coa scaffold')).toBeNull();
    expect(within(list).queryByText('Claude Code')).toBeNull();
  });

  it('drops the backend prefix from a row that already sits under its backend’s header', async () => {
    const user = userEvent.setup();
    setup({ models: MIXED });
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.getByRole('option', { name: /V4 Pro/ }).textContent).toBe('V4 Pro');
  });

  it('names the backend on the trigger, which has no header to sit under', () => {
    setup({ models: MIXED, value: 'ds' });
    const trigger = screen.getByRole('combobox', { name: 'Model' });
    expect(within(trigger).getByRole('img', { name: 'DeepSeek' })).toBeInTheDocument();
    expect(trigger).toHaveTextContent('V4 Pro');
  });

  it('marks each row with its own backend, never coa’s monogram', async () => {
    const user = userEvent.setup();
    setup({ models: MIXED });
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const row = screen.getByRole('option', { name: /V4 Pro/ });
    expect(within(row).getByRole('img', { name: 'DeepSeek' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'coa' })).toBeNull();
  });

  it('marks an untagged model with Claude’s, the backend it actually resolves to', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const row = screen.getByRole('option', { name: /Opus 4\.8/ });
    expect(within(row).getByRole('img', { name: 'Claude' })).toBeInTheDocument();
  });

  it('states the backend default rather than opening on nothing', () => {
    setup({ models: [], value: undefined, effortOptions: [] });
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Backend default');
  });

  it('never writes the empty backend-default row onto the caller', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ models: [], value: undefined, effortOptions: [] });
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /Backend default/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a moved reasoning stop', async () => {
    const user = userEvent.setup();
    const { onEffortChange } = setup({ variant: 'bordered' });
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onEffortChange).toHaveBeenCalledWith('ultra');
  });
});

describe('modelLabel — casing', () => {
  it('capitalizes a name a backend hands over lowercase', () => {
    expect(modelLabel({ id: 'fable-5', displayName: 'fable 5' })).toBe('Fable 5');
    expect(modelLabel({ id: 'x', description: 'fable 5 · most capable' })).toBe('Fable 5');
  });

  it('leaves a name that already carries its own casing exactly as it is', () => {
    expect(modelLabel({ id: 'ds', displayName: 'V4 Pro' })).toBe('V4 Pro');
    // Only the first letter of each word is touched, so an internal capital survives.
    expect(modelLabel({ id: 'x', displayName: 'gpt-4o mini' })).toBe('Gpt-4o Mini');
  });

  it('leaves a bare id alone — an id is an identifier, not a name to be cased', () => {
    expect(modelLabel({ id: 'claude-sonnet-4-6' })).toBe('claude-sonnet-4-6');
    expect(modelLabel({ id: 'LongCat-2.0' })).toBe('LongCat-2.0');
  });
});

describe('ModelPicker — backend rail', () => {
  async function open(models: ModelDescriptor[] = MIXED): Promise<HTMLElement> {
    const user = userEvent.setup();
    setup({ models });
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    return screen.getByRole('group', { name: 'Backend' });
  }

  it('lists only the backends the models actually come from, under an all-backends row', async () => {
    const rail = await open();
    expect(
      within(rail)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['All backends', 'Claude', 'DeepSeek', 'LongCat']);
  });

  it('narrows the list to the backend picked', async () => {
    const user = userEvent.setup();
    const rail = await open();
    await user.click(within(rail).getByRole('button', { name: 'DeepSeek' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['V4 Pro']);
  });

  it('keeps every row wearing its backend mark, scoped or not', async () => {
    const user = userEvent.setup();
    const rail = await open();
    const list = screen.getByRole('listbox', { name: 'Model' });
    expect(within(list).getByRole('img', { name: 'DeepSeek' })).toBeInTheDocument();
    await user.click(within(rail).getByRole('button', { name: 'DeepSeek' }));
    expect(within(list).getByRole('img', { name: 'DeepSeek' })).toBeInTheDocument();
  });

  it('renders no rail at all when every model is one backend — there is nothing to pick', async () => {
    const user = userEvent.setup();
    setup({ models: MODELS });
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.queryByRole('group', { name: 'Backend' })).toBeNull();
  });

  it('keeps naming the current model on the trigger while the list is narrowed past it', async () => {
    const user = userEvent.setup();
    const rail = await open();
    await user.click(within(rail).getByRole('button', { name: 'LongCat' }));
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Sonnet 4.6');
  });

  it('falls back to every backend when the scoped one stops being offered', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Picker models={MIXED} />);
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    const rail = screen.getByRole('group', { name: 'Backend' });
    await user.click(within(rail).getByRole('button', { name: 'DeepSeek' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    // The account behind that backend went away between renders: the scope it named no
    // longer exists, so the list must reopen onto everything rather than onto "No match".
    rerender(<Picker models={MIXED.filter((m) => m.provider !== 'deepseek')} />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});

describe('ModelPicker — field geometry', () => {
  it('spans its container as a field, so the trigger and the ladder share one width', () => {
    setup({ variant: 'bordered' });
    expect(screen.getByRole('combobox', { name: 'Model' }).className).toContain('w-full');
  });

  it('hugs its label as a chip, so the composer shelf keeps its layout', () => {
    setup({ variant: 'chip' });
    const trigger = screen.getByRole('combobox', { name: 'Model' });
    expect(trigger.className).toContain('flex-none');
    expect(trigger.className).not.toContain('w-full');
  });

  it('lays the stop captions on a grid so long names cannot overlap', () => {
    const { container } = render(
      <ModelPicker
        models={MODELS}
        value="sonnet"
        onChange={vi.fn()}
        effortOptions={[
          { value: 'none', label: 'No thinking' },
          { value: 'high', label: 'high' },
          { value: 'max', label: 'max' },
        ]}
        effortValue="high"
        onEffortChange={vi.fn()}
        variant="bordered"
      />,
    );
    // Absolutely-positioned ends sat outside flow, so the centred current value had
    // nothing to push against; three real grid cells cannot collide. Asserted on the
    // STRUCTURE (a grid, one in-flow cell per stop, each truncating) rather than on a
    // literal track listing — the tracks are a sizing decision that has already changed
    // once, and pinning the class made a correct change look like a regression.
    const captions = [...container.querySelectorAll('div')].find((d) =>
      d.className.includes('grid-cols-'),
    );
    expect(captions).toBeDefined();
    expect(captions?.className).toContain('grid');
    expect(captions?.children).toHaveLength(3);
    for (const cell of [...(captions?.children ?? [])]) {
      expect(cell.className).toContain('truncate');
      expect(getComputedStyle(cell).position).not.toBe('absolute');
    }
    expect([...(captions?.children ?? [])].map((c) => c.textContent)).toEqual([
      'No thinking',
      'high',
      'max',
    ]);
  });
});

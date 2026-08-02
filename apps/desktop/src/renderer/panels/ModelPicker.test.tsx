// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ModelDescriptor } from '@coa/console-viewmodel';
import { ModelPicker, type ModelPickerProps } from './ModelPicker.js';

const MODELS: ModelDescriptor[] = [
  { id: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6 · balanced' },
  { id: 'opus', displayName: 'Opus', description: 'Opus 4.8 · deep' },
];
const EFFORTS = [
  { value: 'none', label: 'none' },
  { value: 'think', label: 'think' },
  { value: 'ultra', label: 'ultra' },
];

function setup(overrides: Partial<ModelPickerProps> = {}): {
  onChange: ReturnType<typeof vi.fn>;
  onEffortChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  const onEffortChange = vi.fn();
  render(
    <ModelPicker
      models={MODELS}
      value="sonnet"
      onChange={onChange}
      effortOptions={EFFORTS}
      effortValue="think"
      onEffortChange={onEffortChange}
      variant="chip"
      {...overrides}
    />,
  );
  return { onChange, onEffortChange };
}

describe('ModelPicker', () => {
  it('names the current stop on the chip trigger, which hides its ladder', () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Sonnet 4.6 · think');
  });

  it('leaves the stop off the bordered trigger, whose ladder is already visible', () => {
    setup({ variant: 'bordered' });
    const trigger = screen.getByRole('combobox', { name: 'Model' });
    expect(trigger).toHaveTextContent('Sonnet 4.6');
    expect(trigger).not.toHaveTextContent('think');
    expect(screen.getByRole('slider', { name: 'Reasoning effort' })).toBeInTheDocument();
  });

  it('keeps the chip variant’s ladder in the popup until it is opened', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.getByRole('slider', { name: 'Reasoning effort' })).toBeInTheDocument();
  });

  it('renders no reasoning control at all for a model that offers none', () => {
    setup({ variant: 'bordered', effortOptions: [] });
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
  });

  it('drops the stop from the chip trigger when there is no ladder to name', () => {
    setup({ effortOptions: [] });
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Sonnet 4.6');
  });

  it('reports the picked model', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /Opus/ }));
    expect(onChange).toHaveBeenCalledWith('opus');
  });

  it('groups the options by the harness they run on', async () => {
    const user = userEvent.setup();
    setup({
      models: [...MODELS, { id: 'ds', displayName: 'V4 Pro', provider: 'deepseek' }],
    });
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('coa scaffold')).toBeInTheDocument();
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

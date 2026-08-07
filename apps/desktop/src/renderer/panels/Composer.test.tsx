// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ModelDescriptor } from '@coa/console-viewmodel';
import { Composer, type ComposerProps, type PendingApproval } from './Composer.js';

const MODELS: ModelDescriptor[] = [
  { id: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6 · balanced', provider: 'claude' },
  { id: 'opus', displayName: 'Opus', description: 'Opus 4.8 · deep', provider: 'claude' },
  { id: 'ds', displayName: 'V4 Flash', provider: 'deepseek' },
];
const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
];

function baseProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
  return {
    running: false,
    models: MODELS,
    currentModelId: 'sonnet',
    onPickModel: vi.fn(),
    effortOptions: EFFORTS,
    effortValue: 'high',
    onPickEffort: vi.fn(),
    onSend: vi.fn(),
    ...overrides,
  };
}

const APPROVAL: PendingApproval = { id: 'a1', tool: 'Write', summary: 'writes file.ts' };

describe('Composer — resting', () => {
  it('disables send until text is typed', async () => {
    render(<Composer {...baseProps()} />);
    const send = screen.getByRole('button', { name: 'send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'hi');
    expect(send).not.toBeDisabled();
  });

  it('sends the typed text on Enter and clears the field', async () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps({ onSend })} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(box).toHaveValue('');
  });

  it('rounds the shell on the r4 step', () => {
    const { container } = render(<Composer {...baseProps()} />);
    expect(container.querySelector('.rounded-r4')).toBeTruthy();
    expect(container.querySelector('.rounded-r3')).toBeNull();
  });

  it('hands the picker whole model descriptors, so a backend is not lost on the way to the shelf', async () => {
    render(<Composer {...baseProps()} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    // The shelf used to flatten each model to id+label, which stripped `provider` — so
    // every model resolved to the Claude default and the whole list filed under one
    // backend wearing one mark.
    const row = screen.getByRole('option', { name: /V4 Flash/ });
    expect(within(row).getByRole('img', { name: 'DeepSeek' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('listbox', { name: 'Model' })).getByText('DeepSeek'),
    ).toBeInTheDocument();
  });

  it('gives reasoning its own shelf control, off the model chip', async () => {
    const onPickEffort = vi.fn();
    render(<Composer {...baseProps({ onPickEffort })} />);
    const model = screen.getByRole('combobox', { name: 'Model' });
    expect(model).not.toHaveTextContent('High');
    const reasoning = screen.getByRole('button', { name: 'Reasoning' });
    expect(reasoning).toHaveTextContent('High');
    await userEvent.click(reasoning);
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    slider.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onPickEffort).toHaveBeenCalledWith('low');
  });

  it('leaves the shelf free of native browser tooltips, which the kit cannot style or place', () => {
    render(<Composer {...baseProps({ running: true, onStop: vi.fn(), approval: undefined })} />);
    // `title` is the OS drawing a tooltip over the app: wrong skin, wrong delay, wrong
    // position, and it cannot carry a keybind chip. Every hint goes through the kit's own.
    const titled = [...document.querySelectorAll('[data-composer-shell] [title]')];
    expect(titled.map((el) => el.getAttribute('title'))).toEqual([]);
  });

  it('names its model-and-turn controls through the kit tooltip', async () => {
    render(<Composer {...baseProps()} />);
    for (const name of ['Model', 'Reasoning']) {
      await userEvent.hover(screen.getByRole(name === 'Model' ? 'combobox' : 'button', { name }));
      expect(await screen.findByRole('tooltip')).toBeInTheDocument();
      await userEvent.unhover(screen.getByRole(name === 'Model' ? 'combobox' : 'button', { name }));
    }
  });

  it('an emptied model list degrades to backend-default copy, never an empty menu', async () => {
    render(<Composer {...baseProps({ models: [], currentModelId: undefined })} />);
    // The trigger itself says what actually runs…
    const chip = screen.getByRole('combobox', { name: 'Model' });
    expect(chip).toHaveTextContent(/backend default/i);
    await userEvent.click(chip);
    // …and the open popup states it as the only row rather than presenting nothing.
    expect(await screen.findByRole('option', { name: /Backend default/ })).toBeTruthy();
  });
});

describe('Composer — running', () => {
  it('always shows Stop; Queue and Steer appear only once there is text', async () => {
    render(<Composer {...baseProps({ running: true, onStop: vi.fn() })} />);
    expect(screen.getByRole('button', { name: /stop the running turn/i })).toBeInTheDocument();
    expect(screen.queryByText(/^queue$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^steer$/i)).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'go');
    expect(screen.getByText(/^queue$/i)).toBeInTheDocument();
    expect(screen.getByText(/^steer$/i)).toBeInTheDocument();
  });

  it('Enter queues; Alt+Enter steers', async () => {
    const onQueue = vi.fn();
    const onSteer = vi.fn();
    render(<Composer {...baseProps({ running: true, onQueue, onSteer, onStop: vi.fn() })} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'queue this{Enter}');
    expect(onQueue).toHaveBeenCalledWith('queue this');
    expect(box).toHaveValue('');
    await userEvent.type(box, 'steer this{Alt>}{Enter}{/Alt}');
    expect(onSteer).toHaveBeenCalledWith('steer this');
    expect(box).toHaveValue('');
  });
});

describe('Composer — approval', () => {
  it('the two halves call onDeny / onApprove', async () => {
    const onDeny = vi.fn();
    const onApprove = vi.fn();
    render(<Composer {...baseProps({ approval: APPROVAL, onDeny, onApprove })} />);
    await userEvent.click(screen.getByRole('button', { name: /^deny:/i }));
    expect(onDeny).toHaveBeenCalledWith('a1');
    await userEvent.click(screen.getByRole('button', { name: /^approve:/i }));
    expect(onApprove).toHaveBeenCalledWith('a1');
  });

  it('empty Enter approves; typed Enter redirects', async () => {
    const onApprove = vi.fn();
    const onRedirect = vi.fn();
    render(<Composer {...baseProps({ approval: APPROVAL, onApprove, onRedirect })} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, '{Enter}');
    expect(onApprove).toHaveBeenCalledWith('a1');
    await userEvent.type(box, 'do this instead{Enter}');
    expect(onRedirect).toHaveBeenCalledWith('a1', 'do this instead');
  });

  it('Backspace on an empty field denies', async () => {
    const onDeny = vi.fn();
    render(<Composer {...baseProps({ approval: APPROVAL, onDeny })} />);
    await userEvent.type(screen.getByRole('textbox'), '{Backspace}');
    expect(onDeny).toHaveBeenCalledWith('a1');
  });

  it('labels send "redirect" once there is a pending approval and typed text', async () => {
    render(<Composer {...baseProps({ approval: APPROVAL })} />);
    await userEvent.type(screen.getByRole('textbox'), 'instead');
    expect(screen.getByRole('button', { name: 'redirect' })).toBeInTheDocument();
  });
});

describe('Composer — disabled', () => {
  it('rests every control inert', () => {
    render(<Composer {...baseProps({ disabled: true })} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
  });
});

describe('Composer — mic', () => {
  it('renders permanently disabled, and says on hover that it is unavailable', async () => {
    render(<Composer {...baseProps()} />);
    const mic = screen.getByRole('button', { name: /voice input/i });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute('aria-disabled', 'true');
    // The contract is that the control explains its own unavailability — not the
    // exact wording, and never a promise that it is arriving (docs/UI.md). It says so
    // through the kit's tooltip: a native `title` is drawn by the OS, in the OS's skin.
    // Hovering the WRAPPER, because a disabled button dispatches no pointer events —
    // which is the whole reason the tooltip cannot ride the button itself.
    await userEvent.hover(mic.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/unavailable/i);
  });
});

describe('Composer — model picker', () => {
  it('fires onPickModel when a model is picked', () => {
    const onPickModel = vi.fn();
    render(<Composer {...baseProps({ onPickModel })} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: /Opus 4\.8/ }));
    expect(onPickModel).toHaveBeenCalledWith('opus');
  });

  it('fires onPickEffort when the reasoning slider steps', () => {
    const onPickEffort = vi.fn();
    render(<Composer {...baseProps({ onPickEffort })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reasoning' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } });
    expect(onPickEffort).toHaveBeenCalledWith('low');
  });

  it('hides the reasoning control entirely when effortOptions is empty', () => {
    render(<Composer {...baseProps({ effortOptions: [] })} />);
    expect(screen.queryByRole('button', { name: 'Reasoning' })).not.toBeInTheDocument();
  });
});

describe('Composer — queued', () => {
  it('pins queued messages above the shell and removes on click', () => {
    const onRemoveQueued = vi.fn();
    render(
      <Composer
        {...baseProps({
          queued: [{ id: 'q1', text: 'next up' }],
          onRemoveQueued,
        })}
      />,
    );
    expect(screen.getByText('next up')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove queued message/i }));
    expect(onRemoveQueued).toHaveBeenCalledWith('q1');
  });

  /** The attachment chip's removal control is icon-ONLY too, and it is the one migrated
   *  site the shell never shows without an attachment already staged — so it earns a test
   *  that walks the real path in rather than trusting its twin above. */
  it('draws the attachment removal mark rather than typing one', () => {
    render(<Composer {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^attach$/i }));
    fireEvent.click(screen.getByRole('button', { name: /upload file/i }));
    const remove = screen.getByRole('button', { name: 'remove screenshot.png' });
    expect(remove.querySelector('svg')).not.toBeNull();
    expect(remove.textContent).toBe('');
  });

  /** Label-adjacency law (UI.md): the removal control is icon-ONLY, so its mark is drawn.
   *  The ⇥ chip beside it stays typed — it sits with the queue-position text. */
  it('draws the queued-message removal mark rather than typing one', () => {
    render(<Composer {...baseProps({ queued: [{ id: 'q1', text: 'next up' }] })} />);
    const remove = screen.getByRole('button', { name: /remove queued message/i });
    expect(remove.querySelector('svg')).not.toBeNull();
    expect(remove.textContent).toBe('');
  });
});

describe('Composer — merged notices', () => {
  const DRIFT = {
    id: 'drift',
    kind: 'drift' as const,
    summary: 'The agent configuration changed after this prompt compiled.',
    reason: 'The active prompt still reflects the earlier configuration.',
    actions: [{ id: 'recompile', label: 'Recompile', primary: true }],
  };

  const shell = (c: HTMLElement): HTMLElement =>
    c.querySelector('[data-composer-shell]') as HTMLElement;

  it('renders the notice inside the shell, above the field', () => {
    const { container } = render(<Composer {...baseProps({ notices: [DRIFT] })} />);
    expect(within(shell(container)).getByText('Configuration drift')).toBeInTheDocument();
  });

  it('takes the warn edge only when no session state owns it', () => {
    const { container } = render(<Composer {...baseProps({ notices: [DRIFT] })} />);
    expect(shell(container).className).toContain('border-warn');
  });

  it('never overrides a running turn’s edge, and never starts a shimmer of its own', () => {
    const { container } = render(<Composer {...baseProps({ running: true, notices: [DRIFT] })} />);
    expect(shell(container).className).toContain('border-run');
    expect(shell(container).className).not.toContain('border-warn');
    // One shimmer, owned by the session state — the notice must not add a second.
    expect(container.querySelectorAll('.status-outline')).toHaveLength(1);
  });

  it('ranks the notice above the approval gate', () => {
    const { container } = render(
      <Composer
        {...baseProps({
          notices: [DRIFT],
          approval: { id: 'a1', tool: 'Edit', summary: 'src/x.ts' },
        })}
      />,
    );
    const notice = container.querySelector('[data-notice-kind="drift"]');
    const gate = screen.getByRole('button', { name: /^approve:/i });
    expect(notice?.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reports a notice action to the caller', async () => {
    const onNoticeAction = vi.fn();
    render(<Composer {...baseProps({ notices: [DRIFT], onNoticeAction })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Recompile' }));
    expect(onNoticeAction).toHaveBeenCalledWith('drift', 'recompile');
  });
});

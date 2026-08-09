// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AttachControlVm, ModelDescriptor } from '@coa/console-viewmodel';
import { useNotices } from '../shell/failures.js';
import { attachTooltip, Composer, type ComposerProps, type PendingApproval } from './Composer.js';

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
    mode: 'manual',
    effectiveMode: 'manual',
    onSetMode: vi.fn(),
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

describe('Composer — attach', () => {
  it('renders permanently disabled, and says on hover that it is unavailable', async () => {
    render(<Composer {...baseProps()} />);
    const attach = screen.getByRole('button', { name: /attach a file/i });
    expect(attach).toBeDisabled();
    expect(attach).toHaveAttribute('aria-disabled', 'true');
    // Same contract as the mic: the control explains its own unavailability through
    // the kit's tooltip, hovered via the wrapper because a disabled button dispatches
    // no pointer events.
    await userEvent.hover(attach.parentElement as HTMLElement);
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

describe('Composer — attachments (capability-gated intake)', () => {
  const OPEN: AttachControlVm = {
    image: { enabled: true },
    text: { enabled: true },
    imageSupport: 'supported',
  };
  const NO_VISION: AttachControlVm = {
    image: { enabled: false, reason: 'This model does not accept image input' },
    text: { enabled: true },
    imageSupport: 'unsupported',
  };
  const NO_BACKEND: AttachControlVm = {
    image: { enabled: false, reason: 'This backend cannot carry attachments yet' },
    text: { enabled: false, reason: 'This backend cannot carry attachments yet' },
    imageSupport: 'supported',
  };

  const PNG = (): File =>
    new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
  const MD = (): File => new File(['# notes'], 'notes.md', { type: 'text/markdown' });

  const attachInput = (): HTMLInputElement => {
    const el = document.querySelector('[data-attach-input]');
    if (!(el instanceof HTMLInputElement)) throw new Error('attach input missing');
    return el;
  };

  it('the attach tooltip states what can ride, or exactly why nothing can', () => {
    expect(attachTooltip(OPEN)).toBe('Attach an image or a text file');
    expect(attachTooltip(NO_VISION)).toBe(
      'Attach a text file (This model does not accept image input)',
    );
    expect(attachTooltip(NO_BACKEND)).toBe('This backend cannot carry attachments yet');
    expect(attachTooltip(undefined)).toBe('Attachments are unavailable here');
  });

  it('enables the button when something can ride, disables it (still visible) when nothing can', () => {
    const { rerender } = render(<Composer {...baseProps({ attach: OPEN })} />);
    expect(screen.getByRole('button', { name: 'Attach a file' })).not.toBeDisabled();
    rerender(<Composer {...baseProps({ attach: NO_BACKEND })} />);
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeDisabled();
  });

  it('a picked image stages a chip and rides the send as a real image attachment', async () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps({ attach: OPEN, onSend })} />);
    fireEvent.change(attachInput(), { target: { files: [PNG()] } });
    expect(await screen.findByText('shot.png')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), 'what is this?{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, attachments] = onSend.mock.calls[0] as [string, unknown[]];
    expect(text).toBe('what is this?');
    expect(attachments).toEqual([
      expect.objectContaining({ kind: 'image', mimeType: 'image/png', name: 'shot.png' }),
    ]);
    // The wire contract: base64 payload only, no data: prefix.
    const image = (attachments as { kind: string; data: string }[])[0]!;
    expect(image.data.length).toBeGreaterThan(0);
    expect(image.data.startsWith('data:')).toBe(false);
    // Sent attachments leave the composer — the next send starts clean.
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument();
  });

  it('a text file inlines as a text attachment (no capability gate needed)', async () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps({ attach: NO_VISION, onSend })} />);
    fireEvent.change(attachInput(), { target: { files: [MD()] } });
    expect(await screen.findByText('notes.md')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'summarize{Enter}');
    expect(onSend).toHaveBeenCalledWith('summarize', [
      { kind: 'text', name: 'notes.md', text: '# notes' },
    ]);
  });

  it('pasting an image stages it through the same gate', async () => {
    render(<Composer {...baseProps({ attach: OPEN })} />);
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [PNG()] } });
    expect(await screen.findByText('shot.png')).toBeInTheDocument();
  });

  it('pasting an image on a non-vision model refuses LOUDLY with the model reason, stages nothing', async () => {
    useNotices.getState().dismiss();
    render(<Composer {...baseProps({ attach: NO_VISION })} />);
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [PNG()] } });
    await vi.waitFor(() => {
      expect(useNotices.getState().notice?.detail).toBe('This model does not accept image input.');
    });
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument();
  });

  it('dropping a file on the shell stages it', async () => {
    const { container } = render(<Composer {...baseProps({ attach: OPEN })} />);
    const shell = container.querySelector('[data-composer-shell]');
    if (shell === null) throw new Error('shell missing');
    fireEvent.drop(shell, { dataTransfer: { files: [MD()], types: ['Files'] } });
    expect(await screen.findByText('notes.md')).toBeInTheDocument();
  });

  it('a staged chip is removable before send', async () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps({ attach: OPEN, onSend })} />);
    fireEvent.change(attachInput(), { target: { files: [MD()] } });
    await screen.findByText('notes.md');
    await userEvent.click(screen.getByRole('button', { name: 'Remove attachment: notes.md' }));
    expect(screen.queryByText('notes.md')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'go{Enter}');
    expect(onSend).toHaveBeenCalledWith('go');
  });

  it('an unattachable type refuses with an honest reason', async () => {
    useNotices.getState().dismiss();
    render(<Composer {...baseProps({ attach: OPEN })} />);
    const exe = new File([new Uint8Array([1, 2])], 'tool.exe', {
      type: 'application/octet-stream',
    });
    fireEvent.change(attachInput(), { target: { files: [exe] } });
    await vi.waitFor(() => {
      expect(useNotices.getState().notice?.detail).toBe('tool.exe is not an image or a text file.');
    });
  });

  it('renders the context ring beside the model chip, reading the real window', async () => {
    render(
      <Composer
        {...baseProps({
          ringUsage: { tokensIn: 40_000, tokensOut: 2_000 },
          activeModelMetadata: { id: 'sonnet', provider: 'claude', contextWindow: 200_000 },
        })}
      />,
    );
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '21');
  });

  it('with no window known the ring renders its honest unknown, never a fake fill', () => {
    render(<Composer {...baseProps()} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /context window unknown for this model/i }),
    ).toBeInTheDocument();
  });

  /**
   * Regression: staged attachments/draft text are local, unscoped React state — with
   * no session-switch reset, they survive a `rerender` carrying a DIFFERENT session's
   * props (a new `activeSessionId`, a new `onSend`) and ride out under the WRONG
   * session, or worse, get carried into a session whose backend cannot attach at all.
   */
  describe('session scoping', () => {
    it('drops a staged attachment and drafted text on a session switch, never carrying it into the new session', async () => {
      const onSendA = vi.fn();
      const onSendB = vi.fn();
      const { rerender } = render(
        <Composer
          {...baseProps({ activeSessionId: 'session-a', attach: OPEN, onSend: onSendA })}
        />,
      );
      fireEvent.change(attachInput(), { target: { files: [MD()] } });
      await screen.findByText('notes.md');
      await userEvent.type(screen.getByRole('textbox'), 'about session A');
      expect(screen.getByRole('textbox')).toHaveValue('about session A');

      // Switch to a different session — a new id, a new onSend, the same capabilities.
      rerender(
        <Composer
          {...baseProps({ activeSessionId: 'session-b', attach: OPEN, onSend: onSendB })}
        />,
      );

      // The stale draft/chip must not survive the switch.
      expect(screen.queryByText('notes.md')).not.toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue('');

      // A plain-text send under session B must reach session B's onSend, carrying
      // nothing session A staged.
      await userEvent.type(screen.getByRole('textbox'), 'about session B{Enter}');
      expect(onSendB).toHaveBeenCalledWith('about session B');
      expect(onSendA).not.toHaveBeenCalled();
    });

    it('drops a staged attachment when switching to a session whose backend cannot carry one', async () => {
      const onSend = vi.fn();
      const { rerender } = render(
        <Composer {...baseProps({ activeSessionId: 'session-a', attach: OPEN, onSend })} />,
      );
      fireEvent.change(attachInput(), { target: { files: [MD()] } });
      await screen.findByText('notes.md');

      // Switch to a session on a backend that cannot carry attachments at all.
      rerender(
        <Composer {...baseProps({ activeSessionId: 'session-b', attach: NO_BACKEND, onSend })} />,
      );
      expect(screen.queryByText('notes.md')).not.toBeInTheDocument();

      // A plain-text send under the new session carries no leftover attachment.
      await userEvent.type(screen.getByRole('textbox'), 'go{Enter}');
      expect(onSend).toHaveBeenCalledWith('go');
    });

    it('keeps the draft when re-rendering with the SAME session (not every prop change resets it)', async () => {
      const { rerender } = render(
        <Composer {...baseProps({ activeSessionId: 'session-a', attach: OPEN })} />,
      );
      await userEvent.type(screen.getByRole('textbox'), 'still typing');

      // Same session, unrelated prop changes (e.g. a running-state flip).
      rerender(
        <Composer {...baseProps({ activeSessionId: 'session-a', attach: OPEN, running: true })} />,
      );
      expect(screen.getByRole('textbox')).toHaveValue('still typing');
    });
  });
});

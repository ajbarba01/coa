// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerProps, type PendingApproval } from './Composer.js';

const MODELS = [
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'opus', label: 'Opus 4.8' },
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
});

describe('Composer — running', () => {
  it('always shows Stop; Queue and Barge appear only once there is text', async () => {
    render(<Composer {...baseProps({ running: true, onStop: vi.fn() })} />);
    expect(screen.getByRole('button', { name: 'stop the running turn' })).toBeInTheDocument();
    expect(screen.queryByText('queue')).not.toBeInTheDocument();
    expect(screen.queryByText('barge in')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'go');
    expect(screen.getByText('queue')).toBeInTheDocument();
    expect(screen.getByText('barge in')).toBeInTheDocument();
  });

  it('Enter queues; Alt+Enter barges in', async () => {
    const onQueue = vi.fn();
    const onBarge = vi.fn();
    render(<Composer {...baseProps({ running: true, onQueue, onBarge, onStop: vi.fn() })} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'queue this{Enter}');
    expect(onQueue).toHaveBeenCalledWith('queue this');
    expect(box).toHaveValue('');
    await userEvent.type(box, 'barge this{Alt>}{Enter}{/Alt}');
    expect(onBarge).toHaveBeenCalledWith('barge this');
    expect(box).toHaveValue('');
  });
});

describe('Composer — approval', () => {
  it('the two halves call onDeny / onApprove', async () => {
    const onDeny = vi.fn();
    const onApprove = vi.fn();
    render(<Composer {...baseProps({ approval: APPROVAL, onDeny, onApprove })} />);
    await userEvent.click(screen.getByRole('button', { name: /^deny:/ }));
    expect(onDeny).toHaveBeenCalledWith('a1');
    await userEvent.click(screen.getByRole('button', { name: /^approve:/ }));
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
  it('renders permanently disabled, with a coming-soon title', () => {
    render(<Composer {...baseProps()} />);
    const mic = screen.getByRole('button', { name: /voice input/i });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute('aria-disabled', 'true');
    expect(mic).toHaveAttribute('title', expect.stringContaining('coming soon'));
  });
});

describe('Composer — model chip', () => {
  it('fires onPickModel when a model is picked', () => {
    const onPickModel = vi.fn();
    render(<Composer {...baseProps({ onPickModel })} />);
    fireEvent.click(screen.getByRole('button', { name: /Sonnet 4\.6/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Opus 4.8' }));
    expect(onPickModel).toHaveBeenCalledWith('opus');
  });

  it('fires onPickEffort when the reasoning slider steps', () => {
    const onPickEffort = vi.fn();
    render(<Composer {...baseProps({ onPickEffort })} />);
    fireEvent.click(screen.getByRole('button', { name: /Sonnet 4\.6/ }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } });
    expect(onPickEffort).toHaveBeenCalledWith('low');
  });

  it('hides the reasoning control when effortOptions is empty', () => {
    render(<Composer {...baseProps({ effortOptions: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /Sonnet 4\.6/ }));
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
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
});

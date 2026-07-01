// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders a native button with the primary variant by default', () => {
    render(<Button>Run</Button>);
    const btn = screen.getByRole('button', { name: 'Run' });
    expect(btn).toHaveAttribute('data-variant', 'primary');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('reflects the requested variant', () => {
    render(<Button variant="danger">Stop</Button>);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('data-variant', 'danger');
  });

  it('exposes loading as a data flag, disables interaction, and marks busy', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Run
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-loading', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  it('does not fire onClick while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Run
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders as its child element when asChild is set (polymorphism)', () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('data-variant', 'primary');
  });
});

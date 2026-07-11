// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.js';

describe('Button', () => {
  it('defaults to a quiet, type=button control that fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Approve</Button>);
    const el = screen.getByRole('button', { name: 'Approve' });
    expect(el).toHaveAttribute('type', 'button');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled: no click, no pointer affordance, no hover classes', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Approve
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
    expect(el.className).toContain('cursor-default');
    expect(el.className).not.toContain('hover:');
    expect(el.className).not.toContain('active:');
  });

  it('every variant renders enabled and disabled without leaking the other state', () => {
    for (const variant of ['primary', 'quiet', 'outline', 'block', 'ghost', 'text'] as const) {
      const { unmount } = render(<Button variant={variant}>x</Button>);
      expect(screen.getByRole('button', { name: 'x' }).className).toContain('cursor-pointer');
      unmount();
      const d = render(
        <Button variant={variant} disabled>
          x
        </Button>,
      );
      expect(screen.getByRole('button', { name: 'x' }).className).toContain('cursor-default');
      d.unmount();
    }
  });

  it('merges a caller className', () => {
    render(<Button className="ml-auto">x</Button>);
    expect(screen.getByRole('button', { name: 'x' }).className).toContain('ml-auto');
  });
});

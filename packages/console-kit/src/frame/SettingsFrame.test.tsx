// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogSearchHead, SettingRow, TocRail } from './SettingsFrame.js';

describe('DialogSearchHead', () => {
  it('reports typing and close', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <DialogSearchHead
        value=""
        onChange={onChange}
        onClose={onClose}
        placeholder="search settings…"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('search settings…'), {
      target: { value: 'theme' },
    });
    expect(onChange).toHaveBeenCalledWith('theme');
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('TocRail', () => {
  it('marks the active entry and jumps on click; null active marks nothing', () => {
    const onJump = vi.fn();
    const entries = [
      { id: 'appearance', title: 'appearance' },
      { id: 'daemon', title: 'daemon' },
    ];
    const classTokens = (): string[] =>
      screen.getByRole('button', { name: 'appearance' }).className.split(/\s+/);
    const { rerender } = render(
      <TocRail entries={entries} activeId="appearance" onJump={onJump} />,
    );
    expect(classTokens()).toContain('bg-s3');
    fireEvent.click(screen.getByRole('button', { name: 'daemon' }));
    expect(onJump).toHaveBeenCalledWith('daemon');
    rerender(<TocRail entries={entries} activeId={null} onJump={onJump} />);
    // exact token check — the hover variant `hover:bg-s3` must not satisfy this
    expect(classTokens()).not.toContain('bg-s3');
  });
});

describe('SettingRow', () => {
  it('lays out name, description, and the control slot', () => {
    render(
      <SettingRow name="Theme" desc="Palette scale for the whole console.">
        <button type="button">control</button>
      </SettingRow>,
    );
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByText('Palette scale for the whole console.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'control' })).toBeInTheDocument();
  });
});

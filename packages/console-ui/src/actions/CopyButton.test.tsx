// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton.js';

describe('CopyButton', () => {
  it('writes its text to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton text="hello world" />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('hello world');
  });
});

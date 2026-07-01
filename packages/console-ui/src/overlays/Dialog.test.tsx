// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dialog } from './Dialog.js';

describe('Dialog', () => {
  it('opens from its trigger and shows a titled modal', async () => {
    render(
      <Dialog trigger={<button type="button">Open</button>} title="Confirm rewind">
        Body text
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm rewind' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });
  it('closes on Escape', async () => {
    render(
      <Dialog trigger={<button type="button">Open</button>} title="Confirm">
        Body
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

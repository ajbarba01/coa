// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Popover } from './Popover.js';

describe('Popover', () => {
  it('reveals its content on trigger', async () => {
    render(
      <Popover trigger={<button type="button">Details</button>}>
        <span>Extra info</span>
      </Popover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('Extra info')).toBeInTheDocument();
  });
});

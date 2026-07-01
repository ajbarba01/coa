// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip.js';

describe('Tooltip', () => {
  it('shows its content when the trigger is focused', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Rewind to this checkpoint">
          <button type="button">Rewind</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.tab();
    expect(
      await screen.findByRole('tooltip', { name: 'Rewind to this checkpoint' }),
    ).toBeInTheDocument();
  });
});

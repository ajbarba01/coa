// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from './Banner.js';

describe('Banner', () => {
  it('renders a status region with tone and title', () => {
    render(
      <Banner tone="warning" title="Heads up">
        Disk is low
      </Banner>,
    );
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Disk is low')).toBeInTheDocument();
  });

  it('uses role=alert for the danger tone', () => {
    render(
      <Banner tone="danger" title="Failed">
        Build broke
      </Banner>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-tone', 'danger');
  });

  it('offers a labelled dismiss when onDismiss is given', async () => {
    const onDismiss = vi.fn();
    render(
      <Banner tone="info" title="FYI" onDismiss={onDismiss}>
        x
      </Banner>,
    );
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

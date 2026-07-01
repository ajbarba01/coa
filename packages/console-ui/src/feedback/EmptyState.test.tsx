// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders icon, title, description, and an optional action', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No decisions yet"
        description="They appear as the agent works."
        action={<button type="button">Refresh</button>}
      />,
    );
    expect(screen.getByText('No decisions yet')).toBeInTheDocument();
    expect(screen.getByText('They appear as the agent works.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});

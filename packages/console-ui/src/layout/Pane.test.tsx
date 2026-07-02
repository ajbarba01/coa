// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Pane } from './Pane.js';

describe('Pane', () => {
  it('renders a titled region with its content', () => {
    render(<Pane title="Cost">body</Pane>);
    const region = screen.getByRole('region', { name: 'Cost' });
    expect(region).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders a titleSlot in place of the heading while keeping the region named', () => {
    render(
      <Pane title="Chat" titleSlot={<button type="button">session switcher</button>}>
        body
      </Pane>,
    );
    expect(screen.getByRole('region', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'session switcher' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

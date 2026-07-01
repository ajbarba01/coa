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
});

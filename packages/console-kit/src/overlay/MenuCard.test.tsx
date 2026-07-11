// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CapsLabel, MenuCard, MenuItem } from './MenuCard.js';

describe('MenuItem', () => {
  it('selected renders the tint and the trailing `current` marker', () => {
    render(<MenuItem selected>fable-5</MenuItem>);
    const el = screen.getByRole('button', { name: /fable-5/ });
    expect(el.className).toContain('bg-s4');
    expect(screen.getByText('current')).toBeInTheDocument();
  });

  it('unselected renders hover affordance and no marker', () => {
    render(<MenuItem>opus-4.8</MenuItem>);
    expect(screen.queryByText('current')).not.toBeInTheDocument();
    expect(screen.getByRole('button').className).toContain('hover:bg-s4');
  });

  it('disabled renders inert', () => {
    render(<MenuItem disabled>soon</MenuItem>);
    const el = screen.getByRole('button');
    expect(el).toBeDisabled();
    expect(el.className).toContain('cursor-default');
    expect(el.className).not.toContain('hover:');
  });
});

describe('MenuCard + CapsLabel', () => {
  it('compose a floating card with a section header', () => {
    render(
      <MenuCard data-testid="card">
        <CapsLabel>model</CapsLabel>
        <MenuItem>fable-5</MenuItem>
      </MenuCard>,
    );
    expect(screen.getByTestId('card').className).toContain('shadow-float');
    expect(screen.getByText('model')).toBeInTheDocument();
  });
});

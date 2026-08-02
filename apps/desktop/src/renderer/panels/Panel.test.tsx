// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel.js';

describe('Panel', () => {
  it('names itself as a region so the surface reads as bounded parts', () => {
    render(<Panel label="Context">rows</Panel>);
    expect(screen.getByRole('region', { name: 'Context' })).toBeInTheDocument();
  });

  it('reports a count on the trailing edge of its header', () => {
    render(<Panel label="Reach" count="6 tools" />);
    expect(screen.getByText('6 tools')).toBeInTheDocument();
  });

  it('renders nothing at all for an omitted count (a count that would mislead)', () => {
    render(<Panel label="Runs on">field</Panel>);
    expect(screen.getByRole('region', { name: 'Runs on' })).toHaveTextContent(/^Runs onfield$/);
  });

  it('renders a zero count when the caller means it, since zero is still a fact here', () => {
    render(<Panel label="Roles" count={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('draws no footer region — and so no stray hairline — without one', () => {
    const { container } = render(<Panel label="Runs on">field</Panel>);
    expect(container.querySelector('[data-panel-footer]')).toBeNull();
  });

  it('draws the footer on its own hairline when given one', () => {
    render(
      <Panel label="Roles" footer={<button type="button">Add Role</button>}>
        rows
      </Panel>,
    );
    expect(screen.getByRole('button', { name: 'Add Role' })).toBeInTheDocument();
  });

  it('never floats: no shadow, so it reads as in-flow rather than as a card', () => {
    const { container } = render(<Panel label="Roles">rows</Panel>);
    const region = container.querySelector('[role="region"]');
    expect(region?.className).not.toMatch(/shadow/);
    expect(region?.className).toContain('bg-s2');
  });
});

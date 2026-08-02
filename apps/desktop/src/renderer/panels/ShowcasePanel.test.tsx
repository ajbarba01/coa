// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShowcaseSurface } from './ShowcasePanel.js';

describe('ShowcaseSurface', () => {
  it('renders every component family heading', () => {
    render(<ShowcaseSurface />);
    // 'Actions' dropped with this test: its only specimen (console-ui's Button) has no
    // consumer left in apps/desktop once the agents surface stopped using it — a
    // showcase section with zero non-showcase consumers is dead weight, not a spec.
    // 'Feedback' dropped as a family: InlineMessage and Toast are kit members now, so
    // they render as kit specimens — a second copy under its own heading was the same
    // two components twice.
    for (const family of ['Kit', 'Overlays', 'Dense / Viz', 'Resolved set']) {
      expect(screen.getByRole('heading', { name: family })).toBeTruthy();
    }
  });

  it('drops the Actions family and the Banner specimen — the app has no consumer left for either', () => {
    render(<ShowcaseSurface />);
    expect(screen.queryByRole('heading', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Running in degraded mode')).not.toBeInTheDocument();
  });
});

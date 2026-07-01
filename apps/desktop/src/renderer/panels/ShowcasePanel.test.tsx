// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PanelHostApi } from '@coa/console-layout';
import { showcasePanel } from './ShowcasePanel.js';

const host: PanelHostApi = {
  title: 'Components',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

describe('showcasePanel', () => {
  it('is a routable panel with a null view-model', () => {
    expect(showcasePanel.id).toBe('showcase');
    expect(showcasePanel.selectVm(null as never)).toBeNull();
  });

  it('renders every component family heading', () => {
    const Render = showcasePanel.render;
    render(<Render vm={null} host={host} />);
    for (const family of [
      'Foundations',
      'Actions',
      'Inputs',
      'Data-display',
      'Feedback',
      'Overlays',
      'Layout',
      'Dense / Viz',
    ]) {
      expect(screen.getByRole('heading', { name: family })).toBeTruthy();
    }
  });
});

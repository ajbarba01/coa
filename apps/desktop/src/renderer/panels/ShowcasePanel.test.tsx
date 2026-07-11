// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShowcaseSurface } from './ShowcasePanel.js';

describe('ShowcaseSurface', () => {
  it('renders every component family heading', () => {
    render(<ShowcaseSurface />);
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

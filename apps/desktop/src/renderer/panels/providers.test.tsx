// @vitest-environment jsdom
import { BrandMark } from '@coa/console-kit';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LOCATOR_LABEL, PROVIDERS, providerById } from './providers.js';

describe('the provider registry', () => {
  it('gives every provider a real vector mark, or an honest monogram — never nothing', () => {
    for (const p of PROVIDERS) {
      const hasArt = (p.mark.paths?.length ?? 0) > 0;
      const hasMonogram = p.mark.monogram !== undefined;
      expect(hasArt || hasMonogram).toBe(true);
      expect(p.mark.name.length).toBeGreaterThan(0);
    }
  });

  it('draws the bundled marks as vector art, not as fallback tiles', () => {
    // The regression this pins: a mark whose art fails to reach BrandMark degrades SILENTLY to a
    // monogram tile, which still looks deliberate. Assert the art itself.
    for (const id of ['claude', 'deepseek', 'codex', 'gemini', 'tavily', 'firecrawl', 'parallel']) {
      const p = providerById(id);
      expect(p, id).toBeDefined();
      const { container, unmount } = render(<BrandMark spec={p!.mark} />);
      const paths = container.querySelectorAll('svg path');
      expect(paths.length, `${id} should render vector paths`).toBeGreaterThan(0);
      expect(paths[0]?.getAttribute('d')?.length ?? 0).toBeGreaterThan(20);
      unmount();
    }
  });

  it('names the mark for a screen reader, images or colour off', () => {
    render(<BrandMark spec={providerById('tavily')!.mark} />);
    expect(screen.getByRole('img', { name: 'Tavily' })).toBeTruthy();
  });

  it('has a form for every locator kind a provider declares — the add-flow branches on the kind', () => {
    for (const p of PROVIDERS) {
      expect(LOCATOR_LABEL[p.locator], p.id).toBeTruthy();
    }
  });
});

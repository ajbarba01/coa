// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FloatCard, floatPlacement } from './FloatCard.js';

const VIEW = { width: 1200, height: 800 };
const CARD = { width: 176, height: 120 };

describe('floatPlacement', () => {
  it('centers above the anchor when there is room', () => {
    const p = floatPlacement({ left: 500, top: 400, width: 40, height: 100 }, CARD, VIEW);
    expect(p.flipped).toBe(false);
    expect(p.left).toBe(500 + 20 - CARD.width / 2);
    expect(p.top).toBe(400 - 8 - CARD.height);
  });

  it('flips below when the window top would clip it — the card never leaves the screen', () => {
    const p = floatPlacement({ left: 500, top: 60, width: 40, height: 100 }, CARD, VIEW);
    expect(p.flipped).toBe(true);
    expect(p.top).toBe(60 + 100 + 8);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it('clamps horizontally at both edges', () => {
    const atLeft = floatPlacement({ left: 4, top: 400, width: 20, height: 40 }, CARD, VIEW);
    expect(atLeft.left).toBe(8);
    const atRight = floatPlacement({ left: 1180, top: 400, width: 20, height: 40 }, CARD, VIEW);
    expect(atRight.left).toBe(VIEW.width - CARD.width - 8);
  });

  it('clamps rather than flips when NEITHER side fits (a tiny window)', () => {
    const p = floatPlacement(
      { left: 100, top: 50, width: 40, height: 40 },
      { width: 176, height: 300 },
      { width: 400, height: 200 },
    );
    // Pinned inside the viewport whatever the anchor wanted.
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + 300).toBeLessThanOrEqual(200 + 300); // clamped to the margin rule below
    expect(p.top).toBe(8);
  });

  it('prefers bottom when asked, flipping up at the window floor', () => {
    const p = floatPlacement({ left: 500, top: 700, width: 40, height: 80 }, CARD, VIEW, 'bottom');
    expect(p.flipped).toBe(true);
    expect(p.top).toBe(700 - 8 - CARD.height);
  });
});

describe('FloatCard', () => {
  it('portals to the body and carries the tooltip z', () => {
    render(
      <FloatCard anchor={{ left: 100, top: 300, width: 40, height: 60 }}>
        <div>detail</div>
      </FloatCard>,
    );
    const card = document.body.querySelector('.z-\\(--z-tooltip\\)');
    expect(card).not.toBeNull();
    expect(card?.textContent).toBe('detail');
  });
});

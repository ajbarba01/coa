// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon.js';

/** The kit's SVG glyph. Distinct from the mono CHARACTER glyphs (▣ ⇪ ×) that ride the
 *  `--text-icon` font-size token — this is a drawn mark with its own size axis. */
describe('Icon', () => {
  it('renders the named glyph as an svg', () => {
    const { container } = render(<Icon name="copy" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  /** Default is decorative: the adjacent label already names the action, so a second
   *  announcement is noise. Indicator law — text is for names. */
  it('is hidden from assistive tech by default', () => {
    const { container } = render(<Icon name="copy" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
  });

  /** An icon-ONLY control has no adjacent text, so it must carry the name itself. */
  it('becomes an accessible image when given a label', () => {
    render(<Icon name="copy" label="copy link" />);
    const svg = screen.getByRole('img', { name: 'copy link' });
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });

  /** Color is the parent's job — an icon never carries its own palette step, so it
   *  cannot drift from the text it sits beside. */
  it('inherits color from its parent rather than declaring one', () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  });

  /**
   * Size comes from a token, never a literal (UI.md: no raw values) — and it must ride
   * CSS, not the svg width/height ATTRIBUTES. Presentation attributes do not resolve
   * var(): handing them a token silently discards it and the glyph balloons to lucide's
   * 24px default. This shipped once exactly that way, because the original assertion read
   * getAttribute('width') and jsdom stores an invalid string without complaint. Assert the
   * style, which is the layer that actually sizes the mark.
   */
  it('sizes from the icon token via css, defaulting to sm', () => {
    const { container } = render(<Icon name="copy" />);
    const svg = container.querySelector('svg');
    expect(svg?.style.width).toBe('var(--icon-sm)');
    expect(svg?.style.height).toBe('var(--icon-sm)');

    const { container: md } = render(<Icon name="copy" size="md" />);
    expect(md.querySelector('svg')?.style.width).toBe('var(--icon-md)');
  });

  /** The guard for the bug above: a raw token string in the attribute means sizing is
   *  riding a channel that cannot resolve it. */
  it('never puts an unresolvable token in the size attributes', () => {
    const { container } = render(<Icon name="copy" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width') ?? '').not.toContain('var(');
    expect(svg?.getAttribute('height') ?? '').not.toContain('var(');
  });

  /**
   * The glyph vocabulary an icon-ONLY control needs. Under the label-adjacency law
   * (UI.md) a glyph that IS the control is drawn, so every recurring icon-only
   * affordance in the app — settings, re-read, close — has to exist here or the call
   * site has no conforming option and falls back to a mono character.
   */
  it.each(['settings', 'refresh', 'close'] as const)('carries the %s glyph', (name) => {
    const { container } = render(<Icon name={name} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  /** The house convention observed in the composer's hand-inlined SVGs, now pinned in
   *  one place so call sites cannot drift from it. */
  it('pins the house stroke convention', () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
    expect(svg?.getAttribute('stroke-linecap')).toBe('round');
    expect(svg?.getAttribute('fill')).toBe('none');
  });
});

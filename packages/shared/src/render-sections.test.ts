import { describe, expect, it } from 'vitest';
import { renderSections } from './render-sections.js';
import type { Piece } from './piece.js';

const p = (name: string, body: string, slot?: Piece['slot']): Piece => ({
  name,
  description: name,
  body,
  axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
  ...(slot ? { slot } : {}),
});

describe('renderSections', () => {
  it('emits non-empty slots in DC-6 order under their headers', () => {
    const out = renderSections([
      p('r', 'ROLE', 'roles'),
      p('i', 'IDENT', 'identity'),
      p('t', 'TOOLS', 'tool-use'),
    ]);
    expect(out).toBe('## Identity\n\nIDENT\n\n## Using tools\n\nTOOLS\n\n## Role\n\nROLE');
  });
  it('concatenates multiple pieces in one slot, keeping their input order', () => {
    const out = renderSections([p('a', 'A', 'roles'), p('b', 'B', 'roles')]);
    expect(out).toBe('## Role\n\nA\n\nB');
  });
  it('skips empty slots and renders unslotted pieces last with no header', () => {
    const out = renderSections([p('i', 'IDENT', 'identity'), p('x', 'EXTRA')]);
    expect(out).toBe('## Identity\n\nIDENT\n\nEXTRA');
  });
  it('is deterministic for identical input', () => {
    const pieces = [p('i', 'IDENT', 'identity')];
    expect(renderSections(pieces)).toBe(renderSections(pieces));
  });
});

// Archived from packages/core/src/compiler/import-bundle.test.ts
import { describe, expect, it } from 'vitest';
import { importBundle } from './import-bundle.js';

const VANILLA = `---
name: my-skill
description: does a thing
---
The body of the skill.
`;

describe('importBundle — the SKILL.md → Piece wrap', () => {
  it('North Star: a vanilla SKILL.md (name + description only) wraps to a default-axis Piece', () => {
    const piece = importBundle(VANILLA);

    expect(piece.name).toBe('my-skill');
    expect(piece.description).toBe('does a thing');
    expect(piece.axes).toEqual({ delivery: 'pull', salience: 'never', provenance: 'authored' });
    expect(piece.governedBy).toBeUndefined();
    expect(piece.ccKeys).toBeUndefined();
  });

  it('preserves the Markdown body verbatim', () => {
    expect(importBundle(VANILLA).body).toBe('The body of the skill.\n');
  });

  it('passes unrecognized CC/plugin keys through verbatim into ccKeys', () => {
    const text = `---
name: s
description: d
version: 2.1.0
license: Apache-2.0
allowed-tools: [Read, Edit]
metadata:
  team: platform
---
body
`;
    const piece = importBundle(text);

    expect(piece.ccKeys).toEqual({
      version: '2.1.0',
      license: 'Apache-2.0',
      'allowed-tools': ['Read', 'Edit'],
      metadata: { team: 'platform' },
    });
  });

  it('maps the coa axis keys onto the Piece axes when present', () => {
    const text = `---
name: rule
description: d
delivery: push
scope: src/api
provenance: derived-from-code
salience: 500
---
body
`;
    const piece = importBundle(text);

    expect(piece.axes).toEqual({
      delivery: 'push',
      scope: 'src/api',
      salience: { cadenceTokens: 500 },
      provenance: 'derived-from-code',
    });
  });

  it('maps the governed-by authority link onto governedBy', () => {
    const text = `---
name: rule
description: d
governed-by: [ts-strict, lint]
---
body
`;
    expect(importBundle(text).governedBy).toEqual(['ts-strict', 'lint']);
  });

  it('maps disable-model-invocation to the manualOnly axis, not into ccKeys', () => {
    const text = `---
name: s
description: d
disable-model-invocation: true
---
body
`;
    const piece = importBundle(text);

    expect(piece.axes.manualOnly).toBe(true);
    expect(piece.ccKeys).toBeUndefined();
  });

  it('maps the source import-trust descriptor', () => {
    const text = `---
name: s
description: d
source:
  origin: github.com/acme/rules
  version: 1.4.0
  importTrust: untrusted
---
body
`;
    expect(importBundle(text).source).toEqual({
      origin: 'github.com/acme/rules',
      version: '1.4.0',
      importTrust: 'untrusted',
    });
  });

  it('rejects text with no front-matter block (loud, never a silent empty Piece)', () => {
    expect(() => importBundle('Just a body, no front-matter.')).toThrow();
  });

  it('rejects front-matter missing the required name/description', () => {
    expect(() => importBundle('---\ndescription: d\n---\nbody\n')).toThrow();
  });

  it('rejects an invalid axis value (loud)', () => {
    const text = `---
name: s
description: d
delivery: sideways
---
body
`;
    expect(() => importBundle(text)).toThrow();
  });

  it('is pure — identical text yields an identical Piece', () => {
    expect(importBundle(VANILLA)).toEqual(importBundle(VANILLA));
  });
});

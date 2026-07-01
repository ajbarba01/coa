import { describe, expect, it } from 'vitest';
import { generateCatalog } from './catalog.js';
import type { ComponentIntent } from './intent.js';

const a: ComponentIntent = {
  name: 'Button',
  family: 'Actions',
  intent: 'Triggers an action.',
  useWhen: ['Committing an action.'],
  dontUseWhen: ['Navigating — use Link.'],
  anatomy: 'Icon + label.',
  variantsStates: ['primary', 'disabled'],
  accessibility: 'Native button.',
  related: ['Link'],
};
const b: ComponentIntent = {
  name: 'Banner',
  family: 'Feedback',
  intent: 'Persistent status.',
  useWhen: ['A condition persists.'],
  dontUseWhen: ['Transient — use Toast.'],
  anatomy: 'Icon + message.',
  variantsStates: ['info', 'danger'],
  accessibility: 'role=status.',
  related: ['Toast'],
};

describe('generateCatalog', () => {
  it('groups by family with a stable heading and orders deterministically', () => {
    const md = generateCatalog([b, a]);
    expect(md).toContain('## Actions');
    expect(md).toContain('## Feedback');
    // families alphabetical, components alphabetical within a family
    expect(md.indexOf('## Actions')).toBeLessThan(md.indexOf('## Feedback'));
    expect(md).toContain('### Button');
    expect(md).toContain("Don't use it when");
  });

  it('is idempotent for the same input', () => {
    expect(generateCatalog([a, b])).toBe(generateCatalog([b, a]));
  });
});

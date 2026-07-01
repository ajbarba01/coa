import { describe, expect, it } from 'vitest';
import { assertIntent, type ComponentIntent } from './intent.js';

const valid: ComponentIntent = {
  name: 'Button',
  family: 'Actions',
  intent: 'Triggers the primary action of a view.',
  useWhen: ['A user commits an action (submit, confirm, run).'],
  dontUseWhen: ['Navigating between locations — use Link.'],
  anatomy: 'Optional leading icon, label, optional trailing icon.',
  variantsStates: ['primary', 'rest/hover/active/focus/loading/disabled'],
  accessibility: 'Native <button>; Enter/Space activate; visible focus ring.',
  related: ['IconButton', 'Link'],
};

describe('assertIntent', () => {
  it('returns a fully-populated intent unchanged', () => {
    expect(assertIntent(valid)).toBe(valid);
  });

  it('throws when a string field is empty', () => {
    expect(() => assertIntent({ ...valid, intent: '' })).toThrow(/intent/i);
  });

  it('throws when a list field is empty', () => {
    expect(() => assertIntent({ ...valid, useWhen: [] })).toThrow(/useWhen/i);
  });

  it('throws when a list entry is blank', () => {
    expect(() => assertIntent({ ...valid, related: ['  '] })).toThrow(/related/i);
  });
});

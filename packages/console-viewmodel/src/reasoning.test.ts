import { describe, expect, it } from 'vitest';
import { effortOptions, toReasoning, reasoningValue } from './reasoning.js';

describe('reasoning projection', () => {
  it('lists off + the model effort levels when supported', () => {
    const opts = effortOptions({
      id: 'm',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
    });
    expect(opts.map((o) => o.value)).toEqual(['off', 'low', 'high']);
  });
  it('capitalizes the level labels, which arrive as bare wire values', () => {
    const opts = effortOptions({
      id: 'm',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'xhigh'],
    });
    // The VALUE is the wire token and must not move; only what a person reads changes.
    expect(opts).toEqual([
      { value: 'off', label: 'No thinking' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'xhigh', label: 'Xhigh' },
    ]);
  });
  it('returns no options when the model has no reasoning control at all', () => {
    expect(effortOptions({ id: 'm', supportsEffort: false })).toEqual([]);
    expect(effortOptions(undefined)).toEqual([]);
  });
  it('lists an on/off toggle for a thinking-only model (no effort ladder)', () => {
    expect(effortOptions({ id: 'LongCat-2.0', supportsThinking: true })).toEqual([
      { value: 'off', label: 'Off' },
      { value: 'high', label: 'On' },
    ]);
  });
  it('the thinking toggle round-trips: On maps to thinking-enabled reasoning and back', () => {
    const on = effortOptions({ id: 'LongCat-2.0', supportsThinking: true })[1]!;
    expect(toReasoning(on.value)).toEqual({ mode: 'effort', effort: 'high' });
    expect(reasoningValue(toReasoning(on.value))).toBe(on.value);
  });
  it('maps a value to a ClaudeReasoning', () => {
    expect(toReasoning('off')).toEqual({ mode: 'off' });
    expect(toReasoning('high')).toEqual({ mode: 'effort', effort: 'high' });
  });
  it('maps an invalid value to off reasoning', () => {
    expect(toReasoning('bogus')).toEqual({ mode: 'off' });
  });
  it('extracts reasoning value: off for off mode', () => {
    expect(reasoningValue({ mode: 'off' })).toBe('off');
  });
  it('extracts reasoning value: off for undefined', () => {
    expect(reasoningValue(undefined)).toBe('off');
  });
  it('extracts reasoning value: effort level for effort mode', () => {
    expect(reasoningValue({ mode: 'effort', effort: 'high' })).toBe('high');
    expect(reasoningValue({ mode: 'effort', effort: 'low' })).toBe('low');
    expect(reasoningValue({ mode: 'effort', effort: 'max' })).toBe('max');
  });
  it('round-trips values: high', () => {
    expect(reasoningValue(toReasoning('high'))).toBe('high');
  });
  it('round-trips values: off', () => {
    expect(reasoningValue(toReasoning('off'))).toBe('off');
  });
});

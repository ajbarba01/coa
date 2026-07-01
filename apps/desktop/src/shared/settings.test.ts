import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings.js';

describe('console settings', () => {
  it('fills missing fields from defaults (merge-on-read)', () => {
    expect(parseSettings({ theme: 'light' })).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' });
  });
  it('falls back to defaults on garbage', () => {
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

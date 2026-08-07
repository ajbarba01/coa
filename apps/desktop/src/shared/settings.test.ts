import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings.js';

describe('console settings', () => {
  it('fills missing fields from defaults (merge-on-read)', () => {
    expect(parseSettings({ motion: 'reduce' })).toEqual({ ...DEFAULT_SETTINGS, motion: 'reduce' });
  });
  it('degrades a stale theme value to dark without discarding the rest', () => {
    const parsed = parseSettings({ theme: 'light', motion: 'reduce' });
    expect(parsed.theme).toBe('dark');
    expect(parsed.motion).toBe('reduce');
  });
  it('falls back to defaults on garbage', () => {
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  it('defaults pinnedAgents for settings persisted before the field existed', () => {
    const parsed = parseSettings({ theme: 'dark', density: 'compact', motion: 'full' });
    expect(parsed.pinnedAgents).toEqual([]);
    expect(parseSettings({ pinnedAgents: ['roles/reviewer'] }).pinnedAgents).toEqual([
      'roles/reviewer',
    ]);
  });
  it('defaults zoomLevel to 0 and preserves a persisted level', () => {
    expect(parseSettings({}).zoomLevel).toBe(0);
    expect(parseSettings({ zoomLevel: 3 }).zoomLevel).toBe(3);
    expect(parseSettings({ zoomLevel: -2 }).zoomLevel).toBe(-2);
  });
  it('degrades a garbage zoomLevel to 0 without discarding the rest', () => {
    const parsed = parseSettings({ motion: 'reduce', zoomLevel: 'huge' });
    expect(parsed.zoomLevel).toBe(0);
    expect(parsed.motion).toBe('reduce');
  });
});

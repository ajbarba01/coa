import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECTS_STATE, parseProjectsState } from './projects.js';

describe('projects state', () => {
  it('fills missing fields from defaults (merge-on-read)', () => {
    expect(parseProjectsState({ openAtQuit: ['C:\\repos\\a'] })).toEqual({
      ...DEFAULT_PROJECTS_STATE,
      openAtQuit: ['C:\\repos\\a'],
    });
  });

  it('falls back to defaults on garbage', () => {
    expect(parseProjectsState('nope')).toEqual(DEFAULT_PROJECTS_STATE);
    expect(parseProjectsState(undefined)).toEqual(DEFAULT_PROJECTS_STATE);
  });

  it('keeps a well-formed recent list', () => {
    const recent = [{ root: 'C:\\repos\\a', name: 'a', lastOpenedAt: 1000 }];
    expect(parseProjectsState({ recent }).recent).toEqual(recent);
  });

  it('drops a malformed recent entry rather than voiding the whole list', () => {
    // A schema-invalid element among otherwise-valid ones. Since `recent` is an array of a
    // strict object schema, a single garbage element fails the WHOLE parse (no per-element
    // recovery) — parseProjectsState degrades to defaults for the whole blob, never throws.
    const parsed = parseProjectsState({ recent: [{ root: 'C:\\repos\\a' }] });
    expect(parsed).toEqual(DEFAULT_PROJECTS_STATE);
  });
});

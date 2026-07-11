import { describe, expect, it } from 'vitest';
import {
  BASE_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  appliedLevel,
  clampLevel,
  keyToZoomAction,
  nextLevel,
  type ZoomInput,
} from './zoom.js';

const key = (over: Partial<ZoomInput>): ZoomInput => ({
  type: 'keyDown',
  key: '=',
  control: true,
  meta: false,
  ...over,
});

describe('clampLevel', () => {
  it('holds levels within the supported range and rounds', () => {
    expect(clampLevel(0)).toBe(0);
    expect(clampLevel(2.4)).toBe(2);
    expect(clampLevel(MAX_ZOOM_LEVEL + 3)).toBe(MAX_ZOOM_LEVEL);
    expect(clampLevel(MIN_ZOOM_LEVEL - 3)).toBe(MIN_ZOOM_LEVEL);
  });

  it('treats a non-finite level as 100%', () => {
    expect(clampLevel(Number.NaN)).toBe(0);
    expect(clampLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('nextLevel', () => {
  it('steps in and out by one, clamped at the bounds', () => {
    expect(nextLevel(0, 'in')).toBe(1);
    expect(nextLevel(0, 'out')).toBe(-1);
    expect(nextLevel(MAX_ZOOM_LEVEL, 'in')).toBe(MAX_ZOOM_LEVEL);
    expect(nextLevel(MIN_ZOOM_LEVEL, 'out')).toBe(MIN_ZOOM_LEVEL);
  });

  it('resets to 100% (level 0) from anywhere', () => {
    expect(nextLevel(MAX_ZOOM_LEVEL, 'reset')).toBe(0);
    expect(nextLevel(MIN_ZOOM_LEVEL, 'reset')).toBe(0);
  });
});

describe('appliedLevel', () => {
  it('adds the workbench base scale (1 = 120%) on top of the user offset', () => {
    expect(appliedLevel(0)).toBe(BASE_ZOOM_LEVEL);
    expect(appliedLevel(1)).toBe(BASE_ZOOM_LEVEL + 1);
    expect(appliedLevel(-1)).toBe(BASE_ZOOM_LEVEL - 1);
  });

  it('clamps the user offset before adding the base', () => {
    expect(appliedLevel(MAX_ZOOM_LEVEL + 3)).toBe(BASE_ZOOM_LEVEL + MAX_ZOOM_LEVEL);
    expect(appliedLevel(MIN_ZOOM_LEVEL - 3)).toBe(BASE_ZOOM_LEVEL + MIN_ZOOM_LEVEL);
  });

  it('a reset offset (0) applies as exactly the base (120%)', () => {
    expect(appliedLevel(nextLevel(MAX_ZOOM_LEVEL, 'reset'))).toBe(BASE_ZOOM_LEVEL);
  });
});

describe('keyToZoomAction', () => {
  it('maps the accelerator zoom keys', () => {
    expect(keyToZoomAction(key({ key: '=' }))).toBe('in');
    expect(keyToZoomAction(key({ key: '+' }))).toBe('in'); // numpad + / shifted =
    expect(keyToZoomAction(key({ key: '-' }))).toBe('out');
    expect(keyToZoomAction(key({ key: '0' }))).toBe('reset');
  });

  it('accepts the ⌘ modifier on macOS (meta)', () => {
    expect(keyToZoomAction(key({ control: false, meta: true, key: '-' }))).toBe('out');
  });

  it('ignores keystrokes without the modifier, non-zoom keys, and key-ups', () => {
    expect(keyToZoomAction(key({ control: false, meta: false }))).toBeUndefined();
    expect(keyToZoomAction(key({ key: 'a' }))).toBeUndefined();
    expect(keyToZoomAction(key({ type: 'keyUp' }))).toBeUndefined();
  });
});

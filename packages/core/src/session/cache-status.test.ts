import { describe, expect, it } from 'vitest';
import { cacheColdReasons } from './cache-status.js';

const NOW = '2026-07-02T12:00:00Z';

describe('cacheColdReasons', () => {
  it('is empty on a first send (nothing is cached yet to invalidate)', () => {
    expect(cacheColdReasons({ current: { provider: 'claude' }, now: NOW })).toEqual([]);
  });

  it('is empty when nothing that warms the cache changed', () => {
    expect(
      cacheColdReasons({
        prior: { provider: 'claude', model: 'opus', promptVersion: 'v1', at: NOW },
        current: { provider: 'claude', model: 'opus', promptVersion: 'v1' },
        now: NOW,
        stalenessMs: 5 * 60_000,
      }),
    ).toEqual([]);
  });

  it('flags a provider switch', () => {
    expect(
      cacheColdReasons({
        prior: { provider: 'claude', model: 'opus' },
        current: { provider: 'deepseek', model: 'opus' },
        now: NOW,
      }),
    ).toContain('provider-changed');
  });

  it('flags a model switch', () => {
    expect(
      cacheColdReasons({
        prior: { provider: 'claude', model: 'opus' },
        current: { provider: 'claude', model: 'sonnet' },
        now: NOW,
      }),
    ).toContain('model-changed');
  });

  it('flags a prompt recompile (promptVersion changed on both sides)', () => {
    expect(
      cacheColdReasons({
        prior: { provider: 'claude', promptVersion: 'v1' },
        current: { provider: 'claude', promptVersion: 'v2' },
        now: NOW,
      }),
    ).toContain('prompt-recompiled');
  });

  it('flags staleness when the gap since the last send exceeds the threshold', () => {
    expect(
      cacheColdReasons({
        prior: { provider: 'claude', model: 'opus', at: '2026-07-02T11:50:00Z' },
        current: { provider: 'claude', model: 'opus' },
        now: NOW, // 10 minutes later
        stalenessMs: 5 * 60_000,
      }),
    ).toEqual(['stale']);
  });

  it('does not flag staleness within the threshold', () => {
    expect(
      cacheColdReasons({
        prior: { provider: 'claude', model: 'opus', at: '2026-07-02T11:58:00Z' },
        current: { provider: 'claude', model: 'opus' },
        now: NOW, // 2 minutes later
        stalenessMs: 5 * 60_000,
      }),
    ).toEqual([]);
  });

  it('never flags staleness when the check is off (no/zero threshold, e.g. DeepSeek)', () => {
    const prior = { provider: 'deepseek', model: 'chat', at: '2026-07-01T00:00:00Z' };
    expect(cacheColdReasons({ prior, current: { provider: 'deepseek', model: 'chat' }, now: NOW })).toEqual([]);
    expect(
      cacheColdReasons({ prior, current: { provider: 'deepseek', model: 'chat' }, now: NOW, stalenessMs: 0 }),
    ).toEqual([]);
  });

  it('collects every applicable reason at once', () => {
    const reasons = cacheColdReasons({
      prior: { provider: 'claude', model: 'opus', promptVersion: 'v1', at: '2026-07-02T11:00:00Z' },
      current: { provider: 'deepseek', model: 'chat', promptVersion: 'v2' },
      now: NOW,
      stalenessMs: 5 * 60_000,
    });
    expect(reasons).toEqual(
      expect.arrayContaining(['provider-changed', 'model-changed', 'prompt-recompiled', 'stale']),
    );
  });
});

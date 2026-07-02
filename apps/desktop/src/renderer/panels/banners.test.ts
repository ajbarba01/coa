import { describe, expect, it } from 'vitest';
import { computeChatBanners, configKey } from './banners.js';

const NOW = '2026-07-02T12:00:00Z';
const base = { agentConfig: { role: 'swe' }, now: NOW } as const;

describe('configKey', () => {
  it('is order- and duplicate-independent and treats omitted as empty', () => {
    expect(configKey({ role: 'swe', packageIds: ['a', 'b'] })).toBe(
      configKey({ role: 'swe', packageIds: ['b', 'a', 'a'] }),
    );
    expect(configKey({ role: 'swe' })).toBe(configKey({ role: 'swe', packageIds: [], exclude: [] }));
  });
  it('changes with the role or package selection', () => {
    expect(configKey({ role: 'swe' })).not.toBe(configKey({ role: 'writer' }));
    expect(configKey({ role: 'swe' })).not.toBe(configKey({ role: 'swe', packageIds: ['x'] }));
  });
});

describe('computeChatBanners — cache', () => {
  it('is empty with no pending change and a fresh session', () => {
    expect(
      computeChatBanners({ ...base, pinned: { provider: 'claude', model: 'opus', updatedAt: NOW } }),
    ).toEqual([]);
  });

  it('flags a pending provider switch immediately (before any send)', () => {
    const banners = computeChatBanners({
      ...base,
      pinned: { provider: 'claude', model: 'opus', updatedAt: NOW },
      override: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    });
    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({ kind: 'cache' });
    expect(banners[0]!.reason).toContain('the backend changed');
  });

  it('flags a pending model switch within the same provider', () => {
    const banners = computeChatBanners({
      ...base,
      pinned: { provider: 'claude', model: 'opus', updatedAt: NOW },
      override: { provider: 'claude', model: 'sonnet' },
    });
    expect(banners[0]?.reason).toContain('the model changed');
  });

  it('does not flag when the pending pick equals the pin (a revert clears it)', () => {
    expect(
      computeChatBanners({
        ...base,
        pinned: { provider: 'claude', model: 'opus', updatedAt: NOW },
        override: { provider: 'claude', model: 'opus' },
      }),
    ).toEqual([]);
  });

  it('flags an idle session past the provider TTL, and never for a TTL-off provider', () => {
    const stale = computeChatBanners({
      ...base,
      pinned: { provider: 'claude', model: 'opus', updatedAt: '2026-07-02T11:50:00Z' },
    });
    expect(stale[0]?.reason).toContain('idle');
    expect(
      computeChatBanners({
        ...base,
        pinned: { provider: 'deepseek', model: 'chat', updatedAt: '2026-07-01T00:00:00Z' },
      }),
    ).toEqual([]);
  });
});

describe('computeChatBanners — drift', () => {
  const pinned = { provider: 'claude', model: 'opus', updatedAt: NOW };

  it('is silent with no frozen prompt yet (nothing to drift from)', () => {
    expect(computeChatBanners({ ...base, pinned, agentConfig: { role: 'swe', packageIds: ['x'] } })).toEqual([]);
  });

  it('flags when the agent config diverges from the running prompt config', () => {
    const banners = computeChatBanners({
      ...base,
      pinned,
      frozenConfig: { role: 'swe' },
      agentConfig: { role: 'swe', packageIds: ['research'] },
    });
    expect(banners.some((b) => b.kind === 'drift')).toBe(true);
  });

  it('is silent when the config matches the running prompt (a revert clears it)', () => {
    expect(
      computeChatBanners({ ...base, pinned, frozenConfig: { role: 'swe' }, agentConfig: { role: 'swe' } }),
    ).toEqual([]);
  });

  it('stays dismissed for the dismissed config key, and re-shows once the config changes again', () => {
    const dismissedKey = configKey({ role: 'swe', packageIds: ['research'] });
    const dismissed = computeChatBanners({
      ...base,
      pinned,
      frozenConfig: { role: 'swe' },
      agentConfig: { role: 'swe', packageIds: ['research'] },
      dismissedDriftKey: dismissedKey,
    });
    expect(dismissed.some((b) => b.kind === 'drift')).toBe(false);
    // A further config change is a new key ⇒ the banner returns.
    const changedAgain = computeChatBanners({
      ...base,
      pinned,
      frozenConfig: { role: 'swe' },
      agentConfig: { role: 'swe', packageIds: ['research', 'docs'] },
      dismissedDriftKey: dismissedKey,
    });
    expect(changedAgain.some((b) => b.kind === 'drift')).toBe(true);
  });
});

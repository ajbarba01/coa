import { describe, expect, it } from 'vitest';
import { cacheKey, computeChatBanners, configKey } from './banners.js';

const NOW = '2026-07-02T12:00:00Z';
const base = { agentConfig: { roles: ['swe'] }, hasRun: true, now: NOW } as const;

describe('configKey', () => {
  it('is order- and duplicate-independent and treats omitted as empty', () => {
    expect(configKey({ roles: ['swe'], packageIds: ['a', 'b'] })).toBe(
      configKey({ roles: ['swe'], packageIds: ['b', 'a', 'a'] }),
    );
    expect(configKey({ roles: ['swe'] })).toBe(
      configKey({ roles: ['swe'], packageIds: [], exclude: [] }),
    );
  });
  it('is insensitive to role selection order', () => {
    expect(configKey({ roles: ['swe', 'researcher'] })).toBe(
      configKey({ roles: ['researcher', 'swe'] }),
    );
  });
  it('changes with the role or package selection', () => {
    expect(configKey({ roles: ['swe'] })).not.toBe(configKey({ roles: ['writer'] }));
    expect(configKey({ roles: ['swe'] })).not.toBe(
      configKey({ roles: ['swe'], packageIds: ['x'] }),
    );
  });
});

describe('computeChatBanners — cache', () => {
  it('is empty with no pending change and a fresh session', () => {
    expect(
      computeChatBanners({
        ...base,
        pinned: { provider: 'claude', model: 'opus', updatedAt: NOW },
      }),
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

  it('does not call a session cold before it has ever run', () => {
    const notices = computeChatBanners({
      agentConfig: {},
      hasRun: false,
      pinned: { provider: 'claude', model: 'opus', updatedAt: '2026-07-31T10:00:00.000Z' },
      now: '2026-07-31T11:00:00.000Z',
    });
    expect(notices.find((n) => n.kind === 'cache')).toBeUndefined();
  });

  it('still calls an idle session that has run cold', () => {
    const notices = computeChatBanners({
      agentConfig: {},
      hasRun: true,
      pinned: { provider: 'claude', model: 'opus', updatedAt: '2026-07-31T10:00:00.000Z' },
      now: '2026-07-31T11:00:00.000Z',
    });
    expect(notices.find((n) => n.kind === 'cache')).toBeDefined();
  });
});

describe('computeChatBanners — drift', () => {
  const pinned = { provider: 'claude', model: 'opus', updatedAt: NOW };

  it('is silent with no frozen prompt yet (nothing to drift from)', () => {
    expect(
      computeChatBanners({ ...base, pinned, agentConfig: { roles: ['swe'], packageIds: ['x'] } }),
    ).toEqual([]);
  });

  it('flags when the agent config diverges from the running prompt config', () => {
    const banners = computeChatBanners({
      ...base,
      pinned,
      frozenConfig: { roles: ['swe'] },
      agentConfig: { roles: ['swe'], packageIds: ['research'] },
    });
    expect(banners.some((b) => b.kind === 'drift')).toBe(true);
  });

  it('is silent when the config matches the running prompt (a revert clears it)', () => {
    expect(
      computeChatBanners({
        ...base,
        pinned,
        frozenConfig: { roles: ['swe'] },
        agentConfig: { roles: ['swe'] },
      }),
    ).toEqual([]);
  });

  it('is silent when the roles match but were selected in a different order', () => {
    expect(
      computeChatBanners({
        ...base,
        pinned,
        frozenConfig: { roles: ['swe', 'researcher'] },
        agentConfig: { roles: ['researcher', 'swe'] },
      }),
    ).toEqual([]);
  });

  it('stays dismissed for the dismissed config key, and re-shows once the config changes again', () => {
    const dismissedKey = configKey({ roles: ['swe'], packageIds: ['research'] });
    const dismissed = computeChatBanners({
      ...base,
      pinned,
      frozenConfig: { roles: ['swe'] },
      agentConfig: { roles: ['swe'], packageIds: ['research'] },
      dismissedDriftKey: dismissedKey,
    });
    expect(dismissed.some((b) => b.kind === 'drift')).toBe(false);
    // A further config change is a new key ⇒ the banner returns.
    const changedAgain = computeChatBanners({
      ...base,
      pinned,
      frozenConfig: { roles: ['swe'] },
      agentConfig: { roles: ['swe'], packageIds: ['research', 'docs'] },
      dismissedDriftKey: dismissedKey,
    });
    expect(changedAgain.some((b) => b.kind === 'drift')).toBe(true);
  });
});

describe('computeChatBanners — the merged notice contract', () => {
  const pinned = { provider: 'claude', model: 'opus', updatedAt: NOW };
  const bothRaised = {
    ...base,
    pinned,
    override: { model: 'sonnet' },
    frozenConfig: { roles: ['swe'] },
    agentConfig: { roles: ['swe'], packageIds: ['research'] },
  };

  it('leads with the actionable notice, since it is the one asking for a decision', () => {
    expect(computeChatBanners(bothRaised).map((b) => b.kind)).toEqual(['drift', 'cache']);
  });

  it('carries a short summary alongside the full reason', () => {
    const [drift, cache] = computeChatBanners(bothRaised);
    expect(cache?.summary).toBe('The model changed.');
    expect(cache?.reason).toContain('cold prompt cache');
    expect(drift?.summary).toBe('The agent configuration changed after this prompt compiled.');
    // The summary is a clause; the reason is the paragraph it stands in for.
    expect(drift!.reason.length).toBeGreaterThan(drift!.summary.length);
  });

  it('says both causes in one line when both apply', () => {
    const [cache] = computeChatBanners({
      ...base,
      pinned: { provider: 'claude', model: 'opus', updatedAt: '2026-07-02T11:00:00Z' },
      override: { provider: 'deepseek' },
    });
    expect(cache?.summary).toBe('The backend changed. The session has been idle.');
  });

  it('suppresses a dismissed cache notice until the pick or the pin moves', () => {
    const raised = { ...base, pinned, override: { model: 'sonnet' } };
    const key = cacheKey(raised);
    expect(computeChatBanners({ ...raised, dismissedCacheKey: key })).toEqual([]);
    // Staging a DIFFERENT model is a new key, so the notice comes back.
    const moved = { ...raised, override: { model: 'haiku' } };
    expect(computeChatBanners({ ...moved, dismissedCacheKey: key })).toHaveLength(1);
  });

  it('keys the dismissal to the pin too, so a re-pin re-raises it', () => {
    const raised = { ...base, pinned, override: { model: 'sonnet' } };
    const key = cacheKey(raised);
    const repinned = {
      ...raised,
      pinned: { provider: 'claude', model: 'haiku', updatedAt: NOW },
    };
    expect(computeChatBanners({ ...repinned, dismissedCacheKey: key })).toHaveLength(1);
  });
});

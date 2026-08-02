import { describe, expect, it } from 'vitest';
import { captureSpawn } from './probe-kit.js';

describe('probe-kit — the stub-CLI capture harness', () => {
  it('captures the argv the SDK constructs from Options', async () => {
    const capture = await captureSpawn({
      allowedTools: ['Read', 'Grep'],
      settingSources: [],
    });

    expect(capture.argv.length).toBeGreaterThan(0);
    expect(capture.hasFlag('--allowedTools')).toBe(true);
    expect(capture.flag('--allowedTools')).toContain('Read');
  });

  it('reports a flag as absent when the option is omitted', async () => {
    const capture = await captureSpawn({ settingSources: [] });
    expect(capture.hasFlag('--agents')).toBe(false);
  });

  it('reads a flag the SDK spells inline, and keeps empty distinct from absent', async () => {
    // `settingSources: []` renders as the single token `--setting-sources=`. Read
    // naively that looks like an absent flag, which would invert the D108 probe.
    const capture = await captureSpawn({ settingSources: [] });
    expect(capture.argv).toContain('--setting-sources=');
    expect(capture.hasFlag('--setting-sources')).toBe(true);
    expect(capture.flag('--setting-sources')).toBe('');
    expect(capture.flag('--no-such-flag')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { ModelMetadata } from '@coa/shared';
import {
  attachControlState,
  contextRingState,
  findModelMetadata,
  formatModalities,
  formatPerMillion,
  formatPricing,
  formatTokenCount,
  formatTokenLimit,
  providerCarriesAttachments,
  ringTone,
  usedContextTokens,
} from './model-info.js';

const VISION_MODEL: ModelMetadata = {
  id: 'v4',
  provider: 'deepseek',
  displayName: 'V4',
  contextWindow: 128_000,
  modalities: { input: ['text', 'image'], output: ['text'] },
};

const TEXT_MODEL: ModelMetadata = {
  id: 'v4-lite',
  provider: 'deepseek',
  modalities: { input: ['text'], output: ['text'] },
};

/** No modalities at all — the catalog has no opinion. */
const UNKNOWN_MODEL: ModelMetadata = { id: 'mystery', provider: 'openai' };

describe('usedContextTokens', () => {
  it('sums fresh input, cache reads, and output — cache reads are context too', () => {
    expect(usedContextTokens({ tokensIn: 100, tokensOut: 40, cacheReadTokens: 60 })).toBe(200);
  });

  it('treats absent cache reads as zero, never NaN', () => {
    expect(usedContextTokens({ tokensIn: 10, tokensOut: 5 })).toBe(15);
  });
});

describe('ringTone — the risk ramp', () => {
  it.each([
    [0, 'quiet'],
    [0.42, 'quiet'],
    [0.699, 'quiet'],
    [0.7, 'needs-you'],
    [0.85, 'needs-you'],
    [0.9, 'critical'],
    [1, 'critical'],
  ] as const)('%f → %s', (fraction, tone) => {
    expect(ringTone(fraction)).toBe(tone);
  });
});

describe('contextRingState', () => {
  it('computes the fill fraction from settled usage + the draft estimate over the window', () => {
    const vm = contextRingState({
      usage: { tokensIn: 30_000, tokensOut: 1_500, cacheReadTokens: 500 },
      draftTokens: 1_000,
      contextWindow: 100_000,
    });
    expect(vm).toEqual({
      kind: 'measured',
      usedTokens: 32_000,
      measured: true,
      draftTokens: 1_000,
      contextWindow: 100_000,
      fraction: 0.33,
      percent: 33,
      tone: 'quiet',
    });
  });

  it('ramps to needs-you and critical as usage approaches the window', () => {
    const at = (tokensIn: number): string =>
      (
        contextRingState({
          usage: { tokensIn, tokensOut: 0 },
          contextWindow: 100_000,
        }) as { tone: string }
      ).tone;
    expect(at(69_999)).toBe('quiet');
    expect(at(70_000)).toBe('needs-you');
    expect(at(90_000)).toBe('critical');
  });

  it('clamps overshoot to a full ring instead of overflowing past it', () => {
    const vm = contextRingState({
      // The pure-API loop sums round trips, so the settled figure can exceed the
      // window — the ring saturates rather than lying with a >100% fill.
      usage: { tokensIn: 250_000, tokensOut: 10_000 },
      contextWindow: 200_000,
    });
    expect(vm).toMatchObject({ kind: 'measured', fraction: 1, percent: 100, tone: 'critical' });
  });

  it('reports an unknown window honestly instead of inventing a denominator', () => {
    const vm = contextRingState({
      usage: { tokensIn: 500, tokensOut: 100 },
      draftTokens: 25,
    });
    expect(vm).toEqual({ kind: 'no-window', usedTokens: 600, draftTokens: 25 });
  });

  it('a fresh session with a known window is measured=false at the zero floor', () => {
    const vm = contextRingState({ draftTokens: 120, contextWindow: 200_000 });
    expect(vm).toMatchObject({
      kind: 'measured',
      usedTokens: 0,
      measured: false,
      draftTokens: 120,
      tone: 'quiet',
    });
  });

  it('a fresh session with no window reports both unknowns', () => {
    expect(contextRingState({})).toEqual({
      kind: 'no-window',
      usedTokens: undefined,
      draftTokens: 0,
    });
  });
});

describe('attachControlState — the capability matrix', () => {
  const backend = { backendCarriesAttachments: true };

  it('a vision-capable model enables both kinds', () => {
    const vm = attachControlState(VISION_MODEL, backend);
    expect(vm.image).toEqual({ enabled: true });
    expect(vm.text).toEqual({ enabled: true });
    expect(vm.imageSupport).toBe('supported');
  });

  it('a non-vision model disables images with the verified reason, text stays open', () => {
    const vm = attachControlState(TEXT_MODEL, backend);
    expect(vm.image.enabled).toBe(false);
    expect(vm.image.reason).toBe('This model does not accept image input');
    expect(vm.text).toEqual({ enabled: true });
    expect(vm.imageSupport).toBe('unsupported');
  });

  it('a model with no metadata disables images with the DISTINCT unverified reason', () => {
    const vm = attachControlState(UNKNOWN_MODEL, backend);
    expect(vm.image.enabled).toBe(false);
    expect(vm.image.reason).toBe('Image support is unverified for this model');
    expect(vm.imageSupport).toBe('unknown');
    // Honest-unknown must never share the confident-no wording.
    expect(vm.image.reason).not.toBe(attachControlState(TEXT_MODEL, backend).image.reason);
  });

  it('no metadata row at all behaves as unknown, not as unsupported', () => {
    expect(attachControlState(undefined, backend).imageSupport).toBe('unknown');
  });

  it('a backend with no attachment seam disables everything with one reason', () => {
    const vm = attachControlState(VISION_MODEL, { backendCarriesAttachments: false });
    expect(vm.image.enabled).toBe(false);
    expect(vm.text.enabled).toBe(false);
    expect(vm.image.reason).toBe('This backend cannot carry attachments yet');
    expect(vm.text.reason).toBe(vm.image.reason);
  });
});

describe('providerCarriesAttachments', () => {
  it('mirrors the daemon fact: claude (and the unset default) has no seam yet', () => {
    expect(providerCarriesAttachments('claude')).toBe(false);
    expect(providerCarriesAttachments(undefined)).toBe(false);
    expect(providerCarriesAttachments('deepseek')).toBe(true);
    expect(providerCarriesAttachments('openrouter')).toBe(true);
  });
});

describe('findModelMetadata', () => {
  const entries = [VISION_MODEL, TEXT_MODEL, UNKNOWN_MODEL];

  it('matches on provider AND id — two providers may share an id', () => {
    expect(findModelMetadata(entries, 'deepseek', 'v4')).toBe(VISION_MODEL);
    expect(findModelMetadata(entries, 'openai', 'v4')).toBeUndefined();
  });

  it('an unset provider resolves to claude, the daemon default', () => {
    const claudeRow: ModelMetadata = { id: 'v4', provider: 'claude' };
    expect(findModelMetadata([claudeRow, VISION_MODEL], undefined, 'v4')).toBe(claudeRow);
  });

  it('no model id ⇒ no row, never a guess', () => {
    expect(findModelMetadata(entries, 'deepseek', undefined)).toBeUndefined();
  });
});

describe('formatting', () => {
  it('formats token limits compactly, dropping decimals on clean multiples', () => {
    expect(formatTokenLimit(820)).toBe('820');
    expect(formatTokenLimit(8_000)).toBe('8k');
    expect(formatTokenLimit(131_072)).toBe('131.1k');
    expect(formatTokenLimit(200_000)).toBe('200k');
    expect(formatTokenLimit(1_000_000)).toBe('1M');
    expect(formatTokenLimit(1_500_000)).toBe('1.5M');
  });

  it('formats exact counts with separators', () => {
    expect(formatTokenCount(41_230)).toBe('41,230');
    expect(formatTokenCount(0)).toBe('0');
  });

  it('formats per-million rates without trailing zeros', () => {
    expect(formatPerMillion(3)).toBe('$3');
    expect(formatPerMillion(0.27)).toBe('$0.27');
    expect(formatPerMillion(15.5)).toBe('$15.5');
  });

  it('builds the pricing line from whichever rates exist, or nothing', () => {
    expect(formatPricing({ inputPerMillion: 3, outputPerMillion: 15 })).toBe(
      '$3 in · $15 out /M tokens',
    );
    expect(formatPricing({ outputPerMillion: 15 })).toBe('$15 out /M tokens');
    expect(formatPricing({ cacheReadPerMillion: 0.3 })).toBeUndefined();
    expect(formatPricing(undefined)).toBeUndefined();
  });

  it('builds the modality line only from real data', () => {
    expect(formatModalities({ input: ['text', 'image'], output: ['text'] })).toBe(
      'text, image → text',
    );
    expect(formatModalities(undefined)).toBeUndefined();
  });
});

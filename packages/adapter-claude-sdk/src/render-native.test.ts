import type { NeutralConfig, OrderedPiece, Piece, Reminder } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { renderNative } from './render-native.js';

function piece(name: string, body: string, overrides: Partial<Piece> = {}): Piece {
  return {
    name,
    description: `${name} description`,
    body,
    axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
    ...overrides,
  };
}

function ordered(p: Piece, order: number): OrderedPiece {
  return { piece: p, order };
}

function config(overrides: Partial<NeutralConfig> = {}): NeutralConfig {
  return {
    prefixHead: [],
    systemReminders: [],
    onDemandPullable: [],
    scopePushed: [],
    toolIntents: { allow: [], deny: [] },
    ...overrides,
  };
}

describe('renderNative — the prefix (the byte-stable, most-stable-first systemPrompt)', () => {
  it('orders prefixHead by `order`, independent of input array order', () => {
    const out = renderNative(
      config({
        prefixHead: [ordered(piece('b', 'BODY-B'), 1), ordered(piece('a', 'BODY-A'), 0)],
      }),
    );

    expect(out.systemPrompt).toBe('# coa governance layer\n\nBODY-A\n\nBODY-B');
  });

  it('is deterministic — same input renders byte-identically (no cache self-bust)', () => {
    const cfg = config({
      prefixHead: [ordered(piece('a', 'A'), 0), ordered(piece('b', 'B'), 1)],
      systemReminders: [
        { rule: 'no-raw-sql', reason: 'use the query builder', tier: 0 } as Reminder,
      ],
    });

    expect(renderNative(cfg)).toEqual(renderNative(cfg));
  });
});

describe('renderNative — the capability frame (toolIntents → structural options)', () => {
  it('renders the allow intent to allowedTools and the deny intent to disallowedTools', () => {
    const out = renderNative(
      config({ toolIntents: { allow: ['get_symbol', 'apply_patch'], deny: ['Edit'] } }),
    );

    expect(out.allowedTools).toEqual(['get_symbol', 'apply_patch']);
    expect(out.disallowedTools).toEqual(['Edit']);
  });

  it('renders per-subagent frames structurally', () => {
    const out = renderNative(
      config({
        toolIntents: {
          allow: ['get_symbol'],
          deny: [],
          perAgent: { reviewer: { allow: ['why'], deny: ['apply_patch'] } },
        },
      }),
    );

    expect(out.perAgent).toEqual({
      reviewer: { allowedTools: ['why'], disallowedTools: ['apply_patch'] },
    });
  });

  it('emits an empty perAgent map when no per-subagent frames are present', () => {
    expect(renderNative(config()).perAgent).toEqual({});
  });
});

describe('renderNative — standing authority (systemReminders → prompt + re-anchor)', () => {
  const reminder: Reminder = { rule: 'no-raw-sql', reason: 'use the query builder', tier: 0 };

  it('folds standing reminders into the systemPrompt after the prefix (D108 head/tail)', () => {
    const out = renderNative(
      config({ prefixHead: [ordered(piece('a', 'HEAD'), 0)], systemReminders: [reminder] }),
    );

    expect(out.systemPrompt.startsWith('# coa governance layer\n\nHEAD')).toBe(true);
    expect(out.systemPrompt).toContain('no-raw-sql');
    expect(out.systemPrompt).toContain('use the query builder');
  });

  it('keeps standing authority in the systemPrompt, the only channel that loads', () => {
    // The `.claude/CLAUDE.md` re-anchor could never load: it needs settingSources to
    // include 'project', and coa sets [] precisely to keep the target repo's config out.
    const out = renderNative(config({ systemReminders: [reminder] }));
    expect(out.systemPrompt).toContain('no-raw-sql');
    expect(out).not.toHaveProperty('files');
  });
});

describe('renderNative — layering on the claude_code preset (dropping preset-covered pieces)', () => {
  it('drops the baseline pieces the claude_code preset already covers, keeping coa-specific ones', () => {
    const out = renderNative(
      config({
        prefixHead: [
          ordered(piece('baseline-identity', 'ID-BODY', { slot: 'identity' }), 0),
          ordered(piece('baseline-tone', 'TONE-BODY', { slot: 'tone' }), 1),
          ordered(piece('baseline-tool-use', 'TOOLUSE-BODY', { slot: 'tool-use' }), 2),
          ordered(piece('baseline-environment', 'ENV-BODY', { slot: 'volatile' }), 3),
          ordered(piece('role-swe', 'ROLE-BODY', { slot: 'roles' }), 4),
        ],
      }),
    );

    expect(out.systemPrompt).toContain('ROLE-BODY');
    expect(out.systemPrompt).not.toContain('ID-BODY');
    expect(out.systemPrompt).not.toContain('TONE-BODY');
    expect(out.systemPrompt).not.toContain('TOOLUSE-BODY');
    expect(out.systemPrompt).not.toContain('ENV-BODY');
  });

  it('keeps coa-specific slotted pieces under their DC-6 section headers, under the boundary', () => {
    const out = renderNative(
      config({
        prefixHead: [
          ordered(piece('coa-orientation', 'ORIENT-BODY', { slot: 'governance' }), 0),
          ordered(piece('pkg-coding', 'CODING-BODY', { slot: 'code-discipline' }), 1),
        ],
      }),
    );

    expect(out.systemPrompt.startsWith('# coa governance layer\n\n')).toBe(true);
    expect(out.systemPrompt).toContain('## Operating under coa\n\nORIENT-BODY');
    expect(out.systemPrompt).toContain('## Changing code\n\nCODING-BODY');
  });

  it('keeps the model line — it is near identity, not in the preset-covered set, so Claude gets it too', () => {
    const out = renderNative(
      config({
        prefixHead: [
          ordered(piece('baseline-identity', 'ID-BODY', { slot: 'identity' }), 0),
          ordered(
            piece('baseline-model', 'You are running as claude/claude-opus-4', { slot: 'model' }),
            1,
          ),
        ],
      }),
    );

    expect(out.systemPrompt).toContain('## Model\n\nYou are running as claude/claude-opus-4');
    expect(out.systemPrompt).not.toContain('ID-BODY'); // identity is still dropped
  });

  it('emits an empty systemPrompt (no bare boundary) when everything is dropped and there is no authority', () => {
    const out = renderNative(
      config({
        prefixHead: [
          ordered(piece('baseline-identity', 'ID-BODY', { slot: 'identity' }), 0),
          ordered(piece('baseline-tone', 'TONE-BODY', { slot: 'tone' }), 1),
        ],
      }),
    );

    expect(out.systemPrompt).toBe('');
  });
});

describe('renderNative — the static prompt excludes deferred-delivery content', () => {
  it('does not fold pull-only or scope-pushed bodies into the systemPrompt', () => {
    const out = renderNative(
      config({
        prefixHead: [ordered(piece('head', 'PREFIX-ONLY'), 0)],
        onDemandPullable: ['piece:pulled-ref'],
        scopePushed: [
          piece('scoped', 'SCOPE-PUSHED-BODY', {
            axes: { delivery: 'push', scope: 'api', salience: 'never', provenance: 'authored' },
          }),
        ],
      }),
    );

    expect(out.systemPrompt).toBe('# coa governance layer\n\nPREFIX-ONLY');
    expect(out.systemPrompt).not.toContain('SCOPE-PUSHED-BODY');
    expect(out.systemPrompt).not.toContain('pulled-ref');
  });
});

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

    expect(out.systemPrompt).toBe('BODY-A\n\nBODY-B');
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

    expect(out.systemPrompt.startsWith('HEAD')).toBe(true);
    expect(out.systemPrompt).toContain('no-raw-sql');
    expect(out.systemPrompt).toContain('use the query builder');
  });

  it('re-anchors standing authority into a worktree-relative, gitignorable .claude file (S-5)', () => {
    const out = renderNative(config({ systemReminders: [reminder] }));

    const file = out.files.find((f) => f.path === '.claude/CLAUDE.md');
    expect(file).toBeDefined();
    expect(file?.content).toContain('no-raw-sql');
    // S-5: never absolute, never an escape.
    for (const f of out.files) {
      expect(f.path.startsWith('/')).toBe(false);
      expect(f.path).not.toContain('..');
    }
  });

  it('emits no files when there is no standing authority to re-anchor', () => {
    expect(renderNative(config()).files).toEqual([]);
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

    expect(out.systemPrompt).toBe('PREFIX-ONLY');
    expect(out.systemPrompt).not.toContain('SCOPE-PUSHED-BODY');
    expect(out.systemPrompt).not.toContain('pulled-ref');
  });
});

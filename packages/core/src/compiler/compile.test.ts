import type { CapabilityFrame, ContentAxes, Piece } from '@coa/shared';
import { neutralConfigSchema } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';

const EMPTY_FRAME: CapabilityFrame = { allow: [], deny: [] };

function piece(name: string, axes: Partial<ContentAxes> = {}): Piece {
  return {
    name,
    description: `${name} description`,
    body: `${name} body`,
    axes: { delivery: 'pull', salience: 'never', provenance: 'authored', ...axes },
  };
}

describe('compile — TAX-3 axis→slot routing', () => {
  it('North Star: an empty-config (vanilla-skill) Piece routes to onDemandPullable only', () => {
    // delivery=pull, salience=never, provenance=authored, no link == today's skill behaviour.
    const out = compile([piece('skill')], EMPTY_FRAME);

    expect(out.onDemandPullable).toEqual(['skill']);
    expect(out.prefixHead).toEqual([]);
    expect(out.systemReminders).toEqual([]);
    expect(out.scopePushed).toEqual([]);
  });

  it('routes push + no-scope to the byte-stable prefix head, ordered', () => {
    const out = compile(
      [piece('a', { delivery: 'push' }), piece('b', { delivery: 'push' })],
      EMPTY_FRAME,
    );

    expect(out.prefixHead.map((o) => o.piece.name)).toEqual(['a', 'b']);
    expect(out.prefixHead.map((o) => o.order)).toEqual([0, 1]);
    expect(out.onDemandPullable).toEqual([]);
  });

  it('routes push + scope to scopePushed (runtime-triggered, never the prefix)', () => {
    const out = compile([piece('scoped', { delivery: 'push', scope: 'api' })], EMPTY_FRAME);

    expect(out.scopePushed.map((p) => p.name)).toEqual(['scoped']);
    expect(out.prefixHead).toEqual([]);
  });

  it('adds a Tier-0 systemReminders entry for a salient push Piece', () => {
    const out = compile(
      [piece('rule', { delivery: 'push', salience: { cadenceTokens: 500 } })],
      EMPTY_FRAME,
    );

    expect(out.systemReminders).toEqual([{ rule: 'rule', reason: 'rule description', tier: 0 }]);
  });

  it('does not re-assert a push Piece whose salience is never', () => {
    const out = compile([piece('quiet', { delivery: 'push', salience: 'never' })], EMPTY_FRAME);
    expect(out.systemReminders).toEqual([]);
  });

  it('packs the capability frame through as neutral toolIntents', () => {
    const frame: CapabilityFrame = {
      allow: ['get_symbol'],
      deny: ['Edit'],
      perAgent: { reviewer: { allow: ['why'], deny: [] } },
    };
    expect(compile([], frame).toolIntents).toEqual(frame);
  });

  it('emits a NeutralConfig that validates against the M0 schema and is deterministic', () => {
    const pieces = [
      piece('a', { delivery: 'push' }),
      piece('b'),
      piece('c', { delivery: 'push', scope: 's' }),
    ];
    const out = compile(pieces, EMPTY_FRAME);

    expect(() => neutralConfigSchema.parse(out)).not.toThrow();
    expect(compile(pieces, EMPTY_FRAME)).toEqual(out);
  });
});

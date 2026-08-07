import type { CapabilityFrame, ContentAxes, Piece } from '@coa/shared';
import { neutralConfigSchema } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { compile, type CompileDeps } from './compile.js';

const EMPTY_FRAME: CapabilityFrame = { allow: [], deny: [] };

function piece(name: string, axes: Partial<ContentAxes> = {}, over: Partial<Piece> = {}): Piece {
  return {
    name,
    description: `${name} description`,
    body: `${name} body`,
    axes: { delivery: 'pull', salience: 'never', provenance: 'authored', ...axes },
    ...over,
  };
}

describe('compile — axis→slot routing', () => {
  it('North Star: an empty-config (vanilla-skill) Piece routes to onDemandPullable only, no findings', () => {
    const { config, findings } = compile([piece('skill')], EMPTY_FRAME);

    expect(config.onDemandPullable).toEqual(['skill']);
    expect(config.prefixHead).toEqual([]);
    expect(config.systemReminders).toEqual([]);
    expect(config.scopePushed).toEqual([]);
    expect(findings).toEqual([]);
  });

  it('routes push + no-scope to the byte-stable prefix head, ordered', () => {
    const { config } = compile(
      [piece('a', { delivery: 'push' }), piece('b', { delivery: 'push' })],
      EMPTY_FRAME,
    );

    expect(config.prefixHead.map((o) => o.piece.name)).toEqual(['a', 'b']);
    expect(config.prefixHead.map((o) => o.order)).toEqual([0, 1]);
    expect(config.onDemandPullable).toEqual([]);
  });

  it('routes push + scope to scopePushed (runtime-triggered, never the prefix)', () => {
    const { config } = compile([piece('scoped', { delivery: 'push', scope: 'api' })], EMPTY_FRAME);

    expect(config.scopePushed.map((p) => p.name)).toEqual(['scoped']);
    expect(config.prefixHead).toEqual([]);
  });

  it('adds a Tier-0 systemReminders entry for a salient push Piece', () => {
    const { config } = compile(
      [piece('rule', { delivery: 'push', salience: { cadenceTokens: 500 } })],
      EMPTY_FRAME,
    );

    expect(config.systemReminders).toEqual([{ rule: 'rule', reason: 'rule description', tier: 0 }]);
  });

  it('packs the capability frame through as neutral toolIntents', () => {
    const frame: CapabilityFrame = {
      allow: ['get_symbol'],
      deny: ['Edit'],
      perAgent: { reviewer: { allow: ['why'], deny: [] } },
    };
    expect(compile([], frame).config.toolIntents).toEqual(frame);
  });

  it('emits a NeutralConfig that validates against the shared schema and is deterministic', () => {
    const pieces = [
      piece('a', { delivery: 'push' }),
      piece('b'),
      piece('c', { delivery: 'push', scope: 's' }),
    ];
    const out = compile(pieces, EMPTY_FRAME);

    expect(() => neutralConfigSchema.parse(out.config)).not.toThrow();
    expect(compile(pieces, EMPTY_FRAME)).toEqual(out);
  });
});

describe('compile — most-stable-first prefix ordering', () => {
  it('leads the prefix with authored Pieces ahead of derived-from-code (volatility order)', () => {
    const { config } = compile(
      [
        piece('gen', { delivery: 'push', provenance: 'derived-from-code' }),
        piece('doc', { delivery: 'push', provenance: 'authored' }),
      ],
      EMPTY_FRAME,
    );

    expect(config.prefixHead.map((o) => o.piece.name)).toEqual(['doc', 'gen']);
    expect(config.prefixHead.map((o) => o.order)).toEqual([0, 1]);
  });

  it('is a STABLE sort — equal-stability Pieces keep input order (byte-stable prefix)', () => {
    const { config } = compile(
      [
        piece('a', { delivery: 'push', provenance: 'authored' }),
        piece('b', { delivery: 'push', provenance: 'authored' }),
        piece('c', { delivery: 'push', provenance: 'derived-from-code' }),
        piece('d', { delivery: 'push', provenance: 'derived-from-code' }),
      ],
      EMPTY_FRAME,
    );

    expect(config.prefixHead.map((o) => o.piece.name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('orders systemReminders to follow the most-stable-first prefix sequence', () => {
    const salience = { cadenceTokens: 100 };
    const { config } = compile(
      [
        piece('gen', { delivery: 'push', provenance: 'derived-from-code', salience }),
        piece('doc', { delivery: 'push', provenance: 'authored', salience }),
      ],
      EMPTY_FRAME,
    );

    expect(config.systemReminders.map((r) => r.rule)).toEqual(['doc', 'gen']);
  });
});

describe('compile — normalization + coercion', () => {
  const deps = (over: Partial<CompileDeps> = {}): CompileDeps => ({
    isRegistered: () => true,
    hasGeneratedFrom: () => true,
    ...over,
  });

  it('drops a governed-by link to an unregistered constraint and surfaces it (row 1)', () => {
    const { config, findings } = compile(
      [piece('doc', {}, { governedBy: ['real-rule', 'ghost'] })],
      EMPTY_FRAME,
      deps({ isRegistered: (id) => id === 'real-rule' }),
    );

    expect(config.onDemandPullable).toEqual(['doc']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      concernKey: 'dangling-governance:doc→ghost',
      location: 'doc',
      type: 2,
    });
  });

  it('shares the reactive detector’s concernKey so the two surfaces collapse (CF-7)', () => {
    const { findings } = compile(
      [piece('doc', {}, { governedBy: ['ghost'] })],
      EMPTY_FRAME,
      deps({ isRegistered: () => false }),
    );
    expect(findings[0]?.concernKey).toBe('dangling-governance:doc→ghost');
  });

  it('coerces derived-from-code with no generated-from edge to authored + a notice (row 2)', () => {
    const { config, findings } = compile(
      [piece('snapshot', { delivery: 'push', provenance: 'derived-from-code' })],
      EMPTY_FRAME,
      deps({ hasGeneratedFrom: () => false }),
    );

    expect(config.prefixHead[0]?.piece.axes.provenance).toBe('authored');
    expect(findings.map((f) => f.ruleId)).toContain('tax4:derived-no-source');
  });

  it('leaves a derived Piece that has a generated-from edge as derived (row 2 does not fire)', () => {
    const { config, findings } = compile(
      [piece('api', { provenance: 'derived-from-code' })],
      EMPTY_FRAME,
      deps({ hasGeneratedFrom: () => true }),
    );
    expect(config.onDemandPullable).toEqual(['api']);
    expect(findings.map((f) => f.ruleId)).not.toContain('tax4:derived-no-source');
  });

  it('warns (allows) when legit derived content is pushed to the prefix as authoritative (row 4)', () => {
    const { config, findings } = compile(
      [piece('api', { delivery: 'push', provenance: 'derived-from-code' })],
      EMPTY_FRAME,
      deps({ hasGeneratedFrom: () => true }),
    );
    expect(config.prefixHead.map((o) => o.piece.name)).toEqual(['api']); // still allowed
    expect(findings.map((f) => f.ruleId)).toContain('tax4:derived-as-authoritative');
  });

  it('labels a forceful push rule with no backing check as advisory (row 7)', () => {
    const { findings } = compile(
      [piece('shout', { delivery: 'push', salience: { cadenceTokens: 100 } })],
      EMPTY_FRAME,
      deps(),
    );
    expect(findings.map((f) => f.ruleId)).toContain('tax4:advisory-no-check');
  });

  it('does not run the registry/edge rows when no deps are injected (floor stays silent)', () => {
    const { findings } = compile(
      [piece('doc', { delivery: 'push', provenance: 'derived-from-code' }, { governedBy: ['x'] })],
      EMPTY_FRAME,
    );
    expect(findings.map((f) => f.ruleId)).not.toContain('tax4:governed-by-unregistered');
    expect(findings.map((f) => f.ruleId)).not.toContain('tax4:derived-no-source');
  });

  it('normalization is deterministic (same pieces ⇒ identical config + findings)', () => {
    const pieces = [piece('doc', { delivery: 'push' }, { governedBy: ['ghost'] })];
    const d = deps({ isRegistered: () => false });
    expect(compile(pieces, EMPTY_FRAME, d)).toEqual(compile(pieces, EMPTY_FRAME, d));
  });
});

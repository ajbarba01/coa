import { describe, expect, it } from 'vitest';
import type { ChangeEvent, GraphEdge } from '@coa/shared';
import { validateProducer } from '../flags/producer.js';
import { createGovernanceAnchorProducer, type GovernanceGraph } from './governance-anchor.js';

const govEdge = (from: string, to: string): GraphEdge => ({
  from,
  to,
  type: 'governed-by',
  provenance: 'declared',
});

/** A fake graph: the governed-by edges, plus the set of constraint ids that resolve. */
const graph = (edges: GraphEdge[], registered: string[] = []): GovernanceGraph => ({
  governedByEdges: () => edges,
  isRegistered: (id) => registered.includes(id),
});

const changeOf = (path: string): ChangeEvent =>
  ({
    seq: 1,
    ts: 't',
    worktree: 'main',
    actor: 'session',
    op_id: null,
    provenance: 'inferred',
    cause: null,
    kind: 'modify',
    path,
    pre_hash: 'a',
    post_hash: 'b',
    generated: false,
  }) as unknown as ChangeEvent;

const sweep = { kind: 'scope', scope: 'all' } as const;

describe('createGovernanceAnchorProducer', () => {
  it('flags a referrer whose governing constraint is not a registered check', () => {
    const producer = createGovernanceAnchorProducer(graph([govEdge('docA', 'no-raw-sql')]));
    const flags = producer.run(sweep);

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      ruleId: 'dangling-governance',
      location: 'docA',
      concernKey: 'dangling-governance:docA→no-raw-sql',
      fingerprint: 'dangling-governance:docA→no-raw-sql',
      type: 2,
      severity: 'med',
      confidence: 'low',
    });
    expect(flags[0]?.fix).toBeUndefined();
  });

  it('stays silent when the constraint is a registered check', () => {
    const producer = createGovernanceAnchorProducer(
      graph([govEdge('docA', 'no-raw-sql')], ['no-raw-sql']),
    );
    expect(producer.run(sweep)).toEqual([]);
  });

  it('flags only the unbacked claims when some constraints resolve and some do not', () => {
    const producer = createGovernanceAnchorProducer(
      graph([govEdge('docA', 'no-raw-sql'), govEdge('docB', 'tested')], ['tested']),
    );
    const flags = producer.run(sweep);
    expect(flags.map((f) => f.concernKey)).toEqual(['dangling-governance:docA→no-raw-sql']);
  });

  it('returns the COMPLETE current dangling set on a change event (rebuild-to-follow)', () => {
    const producer = createGovernanceAnchorProducer(
      graph([govEdge('docA', 'gone'), govEdge('docB', 'gone')]),
    );
    const flags = producer.run({ kind: 'change', event: changeOf('anything.ts') });
    expect(flags.map((f) => f.concernKey)).toEqual([
      'dangling-governance:docA→gone',
      'dangling-governance:docB→gone',
    ]);
  });

  it('emits a distinct concern per referrer so they heal independently', () => {
    const producer = createGovernanceAnchorProducer(
      graph([govEdge('docA', 'gone'), govEdge('docB', 'gone')]),
    );
    const keys = producer.run(sweep).map((f) => f.fingerprint);
    expect(new Set(keys).size).toBe(2);
  });

  it('does not run against a tool call', () => {
    const producer = createGovernanceAnchorProducer(graph([govEdge('docA', 'gone')]));
    expect(producer.run({ kind: 'tool', call: {} as never })).toEqual([]);
  });

  it('is a mechanical, model-free producer that passes the CF-6 registration gate', () => {
    const producer = createGovernanceAnchorProducer(graph([]));
    expect(producer.kind).toBe('deterministic');
    expect(validateProducer(producer)).toEqual({ ok: true });
  });
});

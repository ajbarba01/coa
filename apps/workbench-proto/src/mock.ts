import type { Frame, PlanStatus } from './chat/model.js';
import { fid, md, p } from './chat/model.js';
import type { Session } from './store.js';
import { useWorkbench } from './store.js';

/** Seed sessions — the reference cast. `fix-pipe-test` seeds EMPTY so the
 *  fresh-session state is the first thing the canvas shows. */
export function seedSessions(): void {
  const fixPipe: Session = {
    id: 'fix-pipe-test',
    title: 'Fix flaky pipe-transport test',
    agent: 'builder',
    status: 'idle',
    cost: '$1.42',
    flags: 1,
    divider: 'auth-feature',
    recency: 'now',
    branch: 'coa/fix-pipe-test',
    frames: [],
    agents: [{ name: 'builder', status: 'idle', depth: 0 }],
    changes: [],
  };
  const docsSweep: Session = {
    id: 'docs-sweep',
    title: 'Docs sweep: retire spec corpus',
    agent: 'docs-writer',
    status: 'needs-you',
    cost: '$0.87',
    flags: 0,
    recency: '2m',
    frames: [
      {
        kind: 'user',
        id: fid(),
        text: 'Sweep the docs corpus and retire everything the ADRs already cover.',
      },
      {
        kind: 'think',
        id: fid(),
        text: 'The superpowers corpus duplicates ADRs 1–9 almost section for section; the sweep is a bulk delete plus link rewrites in the router.',
        durationMs: 8000,
      },
      {
        kind: 'approval',
        id: fid(),
        tool: 'Bash',
        summary: 'git rm -r docs/superpowers/',
        diffStat: '41 files',
      },
    ],
    agents: [{ name: 'docs-writer', status: 'needs-you', depth: 0 }],
    changes: [{ path: 'docs/adr/0001-consolidate.md', add: 12, del: 0 }],
  };
  const refactorM4: Session = {
    id: 'refactor-m4',
    title: 'Refactor M4 grounding gauntlet',
    agent: 'builder',
    status: 'idle',
    cost: '$3.05',
    flags: 0,
    divider: 'auth-feature',
    recency: '1h',
    frames: [
      { kind: 'user', id: fid(), text: 'Start on the G0→G5 gauntlet refactor.' },
      {
        kind: 'text',
        id: fid(),
        blocks: [
          p(
            'The gauntlet splits cleanly: **G0–G2** are pure predicates, **G3–G5** need the corpus. Starting with the pure half.',
          ),
        ],
      },
      {
        kind: 'tool',
        id: fid(),
        view: {
          tool: 'Edit',
          verb: 'edit',
          target: 'packages/m4/src/gauntlet.ts',
          ok: true,
          meta: '+18 −42',
          link: 'path',
          body: {
            t: 'diff',
            lang: 'ts',
            lines: [
              { k: 'ctx', text: '  export function runGauntlet(rel: Relation): Verdict {' },
              { k: 'del', text: '-   const checks = [g0, g1, g2, g3, g4, g5];' },
              { k: 'add', text: '+   const pure = [g0, g1, g2];' },
              { k: 'add', text: '+   const grounded = [g3, g4, g5];' },
              { k: 'ctx', text: '    // …' },
            ],
          },
        },
      },
      { kind: 'note', id: fid(), text: 'Switched model to fable-5' },
      {
        kind: 'error',
        id: fid(),
        message: 'tree-sitter grammar for .svelte not installed — falling back to the spec tier',
        origin: 'tool',
      },
      {
        kind: 'deny',
        id: fid(),
        denyKind: 'cost-cap',
        reason: 'Session spend reached $3.00 — the cap this session was started with.',
      },
      { kind: 'note', id: fid(), text: 'Session paused at the cap · raise it to continue' },
    ],
    agents: [{ name: 'builder', status: 'idle', depth: 0 }],
    changes: [{ path: 'packages/m4/src/gauntlet.ts', add: 18, del: 42 }],
  };
  const pipeBackoff: Session = {
    id: 'pipe-backoff',
    title: 'Pipe client reconnect backoff',
    agent: 'builder',
    status: 'idle',
    cost: '$0.66',
    flags: 0,
    divider: 'auth-feature',
    recency: '2d',
    frames: [],
    agents: [{ name: 'builder', status: 'idle', depth: 0 }],
    changes: [],
  };
  const daclSpike: Session = {
    id: 'dacl-spike',
    title: 'Named-pipe DACL hardening spike',
    agent: 'researcher',
    status: 'idle',
    cost: '$0.31',
    flags: 0,
    recency: '1w',
    frames: [],
    agents: [{ name: 'researcher', status: 'idle', depth: 0 }],
    changes: [],
  };

  useWorkbench.setState({
    sessions: {
      [fixPipe.id]: fixPipe,
      [docsSweep.id]: docsSweep,
      [refactorM4.id]: refactorM4,
      [pipeBackoff.id]: pipeBackoff,
      [daclSpike.id]: daclSpike,
    },
    order: [fixPipe.id, docsSweep.id, refactorM4.id, pipeBackoff.id, daclSpike.id],
    tabs: [fixPipe.id, 'docs-sweep', 'refactor-m4'],
    activeId: fixPipe.id,
  });
}

/* ------------------------------------------------------------------ */
/* the scripted turn                                                    */
/* ------------------------------------------------------------------ */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run tokens: stop and barge-in kill the in-flight script by bumping the
 *  session's token; every step re-checks it. */
const runToken = new Map<string, number>();

function bump(sessionId: string): number {
  const next = (runToken.get(sessionId) ?? 0) + 1;
  runToken.set(sessionId, next);
  return next;
}

/** Interrupt the running turn (Esc / the Stop control). */
export function stopTurn(sessionId: string): void {
  bump(sessionId);
  const st = useWorkbench.getState();
  st.setRunning(false);
  st.setStatus(sessionId, 'idle');
  st.appendFrame(sessionId, { kind: 'note', id: fid(), text: 'Request interrupted by user' });
}

/** Barge in: the running turn dies mid-flight and the new message takes over. */
export function bargeTurn(sessionId: string, text: string): void {
  bump(sessionId);
  const st = useWorkbench.getState();
  st.setRunning(false);
  st.appendFrame(sessionId, { kind: 'note', id: fid(), text: 'Barge-in — turn redirected' });
  void runScriptedTurn(sessionId, text);
}

/** The scripted turn — realistic frame cadence so the feel is honest. Runs the
 *  pipe-test story regardless of input (it's a prototype). Exercises: per-word
 *  reasoning, tool one-liner + diff card, the plan updating in place, block-
 *  streamed prose, a nested subagent with a roll-up, and an approval gate. */
export async function runScriptedTurn(sessionId: string, userText: string): Promise<void> {
  const st0 = useWorkbench.getState();
  if (st0.running) return;
  const token = bump(sessionId);
  const alive = (): boolean => runToken.get(sessionId) === token && useWorkbench.getState().running;
  const push = (frame: Frame): void => useWorkbench.getState().appendFrame(sessionId, frame);
  const patch = (frameId: string, fn: (f: Frame) => Frame): void =>
    useWorkbench.getState().patchFrame(sessionId, frameId, fn);

  st0.setRunning(true);
  st0.setStatus(sessionId, 'running');
  push({ kind: 'user', id: fid(), text: userText });
  await sleep(650);
  if (!alive()) return;

  // Reasoning streams per-word, settles to the collapsed resting line.
  const thinkId = fid();
  const thought =
    'The failure clusters around server close while a client write is still queued. If teardown races the drain, the socket dies with bytes in flight — checking the ordering in pipe-server.ts first, then the test harness.';
  push({ kind: 'think', id: thinkId, text: '', streaming: true });
  {
    const words = thought.split(' ');
    let acc = '';
    for (const [i, word] of words.entries()) {
      acc += (i === 0 ? '' : ' ') + word;
      const t = acc;
      patch(thinkId, (f) => (f.kind === 'think' ? { ...f, text: t, streaming: true } : f));
      await sleep(34);
      if (!alive()) return;
    }
  }
  patch(thinkId, (f) => (f.kind === 'think' ? { ...f, streaming: false, durationMs: 12000 } : f));
  await sleep(400);
  if (!alive()) return;

  // A read: runs as a one-liner, settles collapsed with its preview behind it.
  const readId = fid();
  push({
    kind: 'tool',
    id: readId,
    view: {
      tool: 'Read',
      verb: 'read',
      target: 'packages/daemon/test/pipe-server.test.ts',
      link: 'path',
    },
  });
  await sleep(900);
  if (!alive()) return;
  patch(readId, (f) =>
    f.kind === 'tool'
      ? {
          ...f,
          view: {
            ...f.view,
            ok: true,
            meta: '214 lines',
            body: {
              t: 'code',
              lang: 'ts',
              text: [
                "test('close drains pending writes', async () => {",
                '  const server = await startPipeServer(sockPath);',
                '  const client = await connect(sockPath);',
                '  const pending = client.write(frame(1));',
                '  await server.close(); // racy: close() returns before drain',
                '  await expect(pending).resolves.toBe(true);',
                '});',
                '',
                'test.each(RETRIES)(…)',
                '// 205 more lines',
              ].join('\n'),
            },
          },
        }
      : f,
  );
  await sleep(500);
  if (!alive()) return;

  // The plan lands, then updates in place as the agent works through it.
  const planId = fid();
  const planItems = (
    statuses: [PlanStatus, PlanStatus, PlanStatus, PlanStatus],
  ): { text: string; status: PlanStatus }[] => [
    { text: 'Reproduce the flake under load', status: statuses[0] },
    { text: 'Drain pending writes before close', status: statuses[1] },
    { text: 'Strengthen the teardown test', status: statuses[2] },
    { text: 'Run the transport suite', status: statuses[3] },
  ];
  push({
    kind: 'plan',
    id: planId,
    items: planItems(['in-progress', 'pending', 'pending', 'pending']),
  });
  await sleep(900);
  if (!alive()) return;
  patch(planId, (f) =>
    f.kind === 'plan'
      ? { ...f, items: planItems(['done', 'in-progress', 'pending', 'pending']) }
      : f,
  );
  await sleep(450);
  if (!alive()) return;

  // The edit: a diff card.
  push({
    kind: 'tool',
    id: fid(),
    view: {
      tool: 'Edit',
      verb: 'edit',
      target: 'packages/daemon/src/transport/pipe-server.ts',
      line: 141,
      ok: true,
      meta: '+9 −3',
      link: 'path',
      body: {
        t: 'diff',
        lang: 'ts',
        lines: [
          { k: 'ctx', text: '  async close(): Promise<void> {' },
          { k: 'del', text: '-   this.server.close();' },
          { k: 'add', text: '+   await this.drainPending();' },
          { k: 'add', text: '+   await closeServer(this.server);' },
          { k: 'ctx', text: "    this.emit('closed');" },
        ],
      },
    },
  });
  useWorkbench.setState((st) => {
    const sess = st.sessions[sessionId];
    if (!sess) return st;
    return {
      sessions: {
        ...st.sessions,
        [sessionId]: {
          ...sess,
          changes: [
            { path: 'daemon/src/transport/pipe-server.ts', add: 9, del: 3 },
            { path: 'daemon/src/transport/pipe-client.ts', add: 6, del: 2 },
          ],
        },
      },
    };
  });
  await sleep(1000);
  if (!alive()) return;

  // Prose streams block by block, the trailing block per-word.
  const textId = fid();
  const para1 =
    'The race is in **close()** — teardown starts while a queued write is still mid-flight, so the socket dies with bytes on the wire. Draining before close fixes the ordering:';
  push({ kind: 'text', id: textId, blocks: [], streaming: true });
  {
    const words = para1.split(' ');
    let acc = '';
    for (const [i, word] of words.entries()) {
      acc += (i === 0 ? '' : ' ') + word;
      const t = acc;
      patch(textId, (f) => (f.kind === 'text' ? { ...f, blocks: [p(t)] } : f));
      await sleep(26);
      if (!alive()) return;
    }
  }
  await sleep(250);
  if (!alive()) return;
  patch(textId, (f) =>
    f.kind === 'text'
      ? {
          ...f,
          blocks: [
            p(para1),
            {
              t: 'ul',
              items: [
                { inline: md('`drainPending()` flushes the write queue before the FIN') },
                { inline: md('`closeServer()` wraps the callback API in a promise') },
              ],
            },
          ],
        }
      : f,
  );
  await sleep(700);
  if (!alive()) return;
  patch(textId, (f) => (f.kind === 'text' ? { ...f, streaming: false } : f));

  // A subagent strengthens the test while the parent verifies — nested work
  // reads behind the rail, then rolls up into a receipt.
  push({ kind: 'subagent', id: fid(), childWorktree: 'wt/test-writer', event: 'spawn' });
  await sleep(700);
  if (!alive()) return;
  push({
    kind: 'tool',
    id: fid(),
    depth: 1,
    view: {
      tool: 'Grep',
      verb: 'searched',
      target: 'drainPending',
      ok: true,
      meta: '3 hits',
      body: {
        t: 'matches',
        hits: [
          {
            path: 'daemon/src/transport/pipe-server.ts',
            line: 143,
            text: 'await this.drainPending();',
          },
          {
            path: 'daemon/src/transport/pipe-server.ts',
            line: 171,
            text: 'private async drainPending(',
          },
          { path: 'daemon/test/pipe-server.test.ts', line: 88, text: 'drains pending writes' },
        ],
      },
    },
  });
  await sleep(800);
  if (!alive()) return;
  push({
    kind: 'tool',
    id: fid(),
    depth: 1,
    view: {
      tool: 'Edit',
      verb: 'edit',
      target: 'packages/daemon/test/pipe-server.test.ts',
      ok: true,
      meta: '+21 −2',
      link: 'path',
      body: {
        t: 'diff',
        lang: 'ts',
        lines: [
          { k: 'add', text: "+ test('close drains under concurrent writers', async () => {" },
          {
            k: 'add',
            text: '+   const writers = Array.from({ length: 8 }, () => hammer(client));',
          },
          { k: 'add', text: '+   await server.close();' },
          { k: 'add', text: '+   await expect(Promise.all(writers)).resolves.toBeDefined();' },
          { k: 'add', text: '+ });' },
        ],
      },
    },
  });
  await sleep(900);
  if (!alive()) return;
  push({
    kind: 'subagent',
    id: fid(),
    childWorktree: 'wt/test-writer',
    event: 'rollup',
    rollup: { tools: 4, tokens: 18200, cost: 0.12, status: 'done' },
  });
  await sleep(500);
  if (!alive()) return;

  patch(planId, (f) =>
    f.kind === 'plan' ? { ...f, items: planItems(['done', 'done', 'done', 'in-progress']) } : f,
  );
  await sleep(400);
  if (!alive()) return;

  // The verification needs a budget exception — the gate waits on you.
  push({
    kind: 'approval',
    id: fid(),
    tool: 'Bash',
    summary: 'pnpm vitest run --project daemon --retry=8',
    diffStat: 'retry ×8',
  });
  useWorkbench.getState().setRunning(false);
  useWorkbench.getState().setStatus(sessionId, 'needs-you');
}

/** "Tell the agent to do something else": the gate resolves as a deny and the
 *  typed instruction takes its place as the next turn's input. */
export function redirectApproval(sessionId: string, frameId: string, text: string): void {
  const st = useWorkbench.getState();
  st.patchFrame(sessionId, frameId, (f) =>
    f.kind === 'approval' ? { ...f, resolved: 'denied' } : f,
  );
  st.appendFrame(sessionId, { kind: 'user', id: fid(), text });
  void continueAfterRedirect(sessionId);
}

async function continueAfterRedirect(sessionId: string): Promise<void> {
  const token = bump(sessionId);
  const alive = (): boolean => runToken.get(sessionId) === token && useWorkbench.getState().running;
  const st = useWorkbench.getState();
  st.setRunning(true);
  st.setStatus(sessionId, 'running');
  await sleep(900);
  if (!alive()) return;
  useWorkbench.getState().appendFrame(sessionId, {
    kind: 'text',
    id: fid(),
    blocks: [
      p(
        'Understood — dropping the retry loop. Running the suite **once, no retries**, and treating any flake as a real failure to chase.',
      ),
    ],
  });
  await sleep(600);
  if (!alive()) return;
  useWorkbench.getState().setRunning(false);
  useWorkbench.getState().setStatus(sessionId, 'idle');
}

/** Resolve an approval; approval continues the story (checks pass, the plan
 *  closes, the turn settles). */
export function resolveScriptedApproval(
  sessionId: string,
  frameId: string,
  decision: 'approved' | 'denied',
): void {
  const st = useWorkbench.getState();
  st.patchFrame(sessionId, frameId, (f) =>
    f.kind === 'approval' ? { ...f, resolved: decision } : f,
  );
  if (decision === 'denied') {
    st.setStatus(sessionId, 'idle');
    st.appendFrame(sessionId, {
      kind: 'note',
      id: fid(),
      text: 'Request denied — the turn ends here',
    });
    return;
  }
  void continueAfterApproval(sessionId);
}

async function continueAfterApproval(sessionId: string): Promise<void> {
  const token = bump(sessionId);
  const alive = (): boolean => runToken.get(sessionId) === token && useWorkbench.getState().running;
  const push = (frame: Frame): void => useWorkbench.getState().appendFrame(sessionId, frame);

  useWorkbench.getState().setRunning(true);
  useWorkbench.getState().setStatus(sessionId, 'running');
  await sleep(500);
  if (!alive()) return;

  push({
    kind: 'tool',
    id: fid(),
    view: {
      tool: 'run_checks',
      verb: 'checked',
      target: 'transport suite',
      ok: true,
      meta: '6 checks',
      body: {
        t: 'checks',
        checks: [
          { name: 'pipe-server.test.ts', ok: true, ms: 1840 },
          { name: 'pipe-client.test.ts', ok: true, ms: 920 },
          { name: 'framing.test.ts', ok: true, ms: 310 },
          { name: 'backoff.test.ts', ok: true, ms: 240 },
          { name: 'typecheck', ok: true, ms: 4100 },
          { name: 'lint', ok: true, ms: 1300 },
        ],
      },
    },
  });
  await sleep(1200);
  if (!alive()) return;

  const st = useWorkbench.getState();
  const sess = st.sessions[sessionId];
  const planFrame = sess?.frames.find((f) => f.kind === 'plan');
  if (planFrame !== undefined) {
    st.patchFrame(sessionId, planFrame.id, (f) =>
      f.kind === 'plan'
        ? { ...f, items: f.items.map((it) => ({ ...it, status: 'done' as const })) }
        : f,
    );
  }
  await sleep(400);
  if (!alive()) return;

  push({
    kind: 'text',
    id: fid(),
    blocks: [
      p(
        'Green across the suite — 8 concurrent writers survive close. The fix is **drain-then-close**; the strengthened test would have caught the original race.',
      ),
    ],
  });
  useWorkbench.getState().setRunning(false);
  useWorkbench.getState().setStatus(sessionId, 'done');
}

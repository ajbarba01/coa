import type { Frame, Session } from './store.js';
import { useWorkbench } from './store.js';

let nextId = 0;
const id = (): string => `f${nextId++}`;

/** Seed sessions — the v7.2 reference cast. */
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
        id: id(),
        text: 'Sweep the docs corpus and retire everything the ADRs already cover.',
      },
      {
        kind: 'approval',
        id: id(),
        tool: 'Bash',
        cmd: 'git rm -r docs/superpowers/',
        why: 'bulk delete touches 40+ tracked files · M3',
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
    frames: [{ kind: 'user', id: id(), text: 'Start on the G0→G5 gauntlet refactor.' }],
    agents: [{ name: 'builder', status: 'idle', depth: 0 }],
    changes: [],
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The scripted turn — realistic frame cadence so the feel is honest.
 *  Runs against fix-pipe-test regardless of input text (it's a prototype). */
export async function runScriptedTurn(sessionId: string, userText: string): Promise<void> {
  const s = useWorkbench.getState();
  if (s.running) return;
  const push = (frame: Frame): void => useWorkbench.getState().appendFrame(sessionId, frame);

  s.setRunning(true);
  s.setStatus(sessionId, 'running');
  push({ kind: 'user', id: id(), text: userText });
  await sleep(700);

  // Reasoning streams per-word.
  const thought =
    'The failure clusters around server close while a client write is still queued… checking teardown ordering in pipe-server.ts ›';
  push({ kind: 'think', id: id(), text: '', streaming: true });
  for (const [i, word] of thought.split(' ').entries()) {
    const st = useWorkbench.getState();
    const sess = st.sessions[sessionId];
    const current = sess?.frames.filter((f) => f.kind === 'think').at(-1);
    const base = current && current.kind === 'think' ? current.text : '';
    st.patchLastThink(sessionId, base + (i === 0 ? '' : ' ') + word, true);
    await sleep(40);
  }
  useWorkbench.getState().patchLastThink(sessionId, thought, false);
  await sleep(350);

  push({ kind: 'tool', id: id(), tk: 'R', label: 'pipe-server.test.ts' });
  await sleep(900);

  push({
    kind: 'toolx',
    id: id(),
    tk: 'E',
    file: 'packages/daemon/src/transport/pipe-server.ts',
    add: 9,
    del: 3,
    diff: [
      { t: 'c', line: '  async close(): Promise<void> {' },
      { t: 'd', line: '-   this.server.close();' },
      { t: 'a', line: '+   await this.drainPending();' },
      { t: 'a', line: '+   await closeServer(this.server);' },
      { t: 'c', line: "    this.emit('closed');" },
    ],
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
  await sleep(1100);

  push({
    kind: 'text',
    id: id(),
    text: 'The race is in **close()** — teardown starts while a queued write is mid-flight. Fixed by draining before close; dispatching a subagent to strengthen the test while I verify.',
  });
  await sleep(800);

  push({
    kind: 'subagent',
    id: id(),
    name: 'test-writer',
    status: 'running',
    tick: '4 tools · $0.12',
  });
  useWorkbench.setState((st) => {
    const sess = st.sessions[sessionId];
    if (!sess) return st;
    return {
      sessions: {
        ...st.sessions,
        [sessionId]: {
          ...sess,
          agents: [
            { name: 'builder', status: 'running', depth: 0 },
            { name: 'test-writer', status: 'running', cost: '$0.12', depth: 1 },
          ],
          changes: [
            ...sess.changes,
            { path: 'daemon/test/pipe-server.test.ts', add: 21, del: 2 },
            { path: 'daemon/test/helpers/net.ts', add: 6, del: 4 },
          ],
        },
      },
    };
  });
  await sleep(1200);

  push({
    kind: 'approval',
    id: id(),
    tool: 'Bash',
    cmd: 'pnpm vitest run --project daemon --retry=8',
    why: 'retry-loop exceeds the verification budget · M3',
  });
  useWorkbench.getState().setRunning(false);
  // Status stays 'running' until the approval is resolved — the daemon owns it;
  // the prototype flips it on resolve (see Chat's onResolve).
}

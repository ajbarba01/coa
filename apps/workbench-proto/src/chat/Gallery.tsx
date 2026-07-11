import { cx } from '@coa/console-kit';
import { useEffect, useState } from 'react';
import { Composer } from './Composer.js';
import { CodeBlock } from './CodeBlock.js';
import { Prose } from './Prose.js';
import { ToolFrame } from './ToolCard.js';
import { Transcript } from './Transcript.js';
import type { Block, Frame, PlanStatus } from './model.js';
import { md, p, parseMarkdown } from './model.js';
import { TranscriptOverlayHost } from './overlay.js';
import { rawProjection } from './raw.js';
import {
  ApprovalRow,
  DenyRow,
  ErrorRow,
  NoteRow,
  PlanRow,
  RawRow,
  SubagentRow,
  ThinkRow,
  UserRow,
} from './rows.js';

/** The conversation spec — every frame kind, every state, inspectable without
 *  a daemon. Notes carry the rulings, so an implementer ports the surface
 *  without making an aesthetic decision of their own. Motion states replay. */
export function Gallery(): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-10 px-8 py-8">
      <ProseSpec />
      <MarkdownPlayground />
      <StreamingSpec />
      <CodeSpec />
      <PaletteSpec />
      <ToolSpec />
      <PlanSpec />
      <ThinkSpec />
      <SubagentSpec />
      <ApprovalSpec />
      <DenySpec />
      <ErrorNoteSpec />
      <RawSpec />
      <EmptySpec />
      <ComposerSpec />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* scaffolding                                                          */
/* ------------------------------------------------------------------ */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3 border-b border-s3 pb-2">
        <h2 className="text-body font-semibold text-s12">{title}</h2>
        {note && <span className="min-w-0 font-mono text-meta text-s8">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** The transcript's own ground (s1), framed for the spec page. */
function Canvas({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cx('flex flex-col gap-3.5 rounded-r2 border border-s4 bg-s1 p-5', className)}>
      {children}
    </div>
  );
}

function Cap({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mb-1.5 font-mono text-caps text-s7">{children}</div>;
}

/** Remount-to-replay wrapper for motion states. */
function Replay({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <div key={key}>{children}</div>
      <button
        type="button"
        onClick={() => setKey((k) => k + 1)}
        className="slip cursor-pointer self-start font-mono text-caps text-s7 hover:text-s9"
      >
        replay ↻
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · prose                                                            */
/* ------------------------------------------------------------------ */

const PROSE_SPECIMEN: Block[] = [
  { t: 'h1', inline: md('The pipe transport, settled') },
  p(
    'Hierarchy is carried by **weight and space**, never by color or size jumps. Body ink is s11; emphasis reaches s12; links stay ink with a *stepped-down underline* — like [the Radix scale docs](https://www.radix-ui.com/colors) — and `inline code` sits on an s3 chip.',
  ),
  { t: 'h2', inline: md('What changed') },
  p('Ordered work reads as a sequence; unordered work reads as a set:'),
  {
    t: 'ol',
    items: [
      { inline: md('Drain pending writes before the FIN handshake') },
      { inline: md('Wrap the callback API in a promise (`closeServer`)') },
      { inline: md('Re-run the suite under 8 concurrent writers') },
    ],
  },
  {
    t: 'ul',
    items: [
      {
        inline: md('transport invariants'),
        sub: {
          t: 'ul',
          items: [
            { inline: md('a queued write always lands or always rejects') },
            { inline: md('`close()` never races the drain') },
          ],
        },
      },
      { inline: md('test harness gains a `hammer()` helper') },
    ],
  },
  { t: 'h3', inline: md('The verdict') },
  {
    t: 'quote',
    blocks: [
      p(
        'A blockquote is a **secondary voice**: one hairline step down in ink (s10), a 2px s5 rule, never italicized wholesale.',
      ),
    ],
  },
  {
    t: 'table',
    head: ['suite', 'before', 'after'],
    rows: [
      ['pipe-server', '3 flakes / 100', '0 / 500'],
      ['pipe-client', '1 flake / 100', '0 / 500'],
      ['framing', 'clean', 'clean'],
    ],
  },
  { t: 'hr' },
  p('A horizontal rule is a thematic break — the s3 hairline, nothing heavier.'),
];

function ProseSpec(): React.JSX.Element {
  return (
    <Section
      title="assistant prose"
      note="weight + space carry hierarchy · ink s11, emphasis s12, quotes s10 · links underline, never color"
    >
      <Canvas>
        <div className="max-w-[65ch]">
          <Prose blocks={PROSE_SPECIMEN} />
        </div>
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 1b · markdown playground                                             */
/* ------------------------------------------------------------------ */

const PLAYGROUND_SEED = `## Try the vocabulary

Type **markdown** on the left; the transcript's renderer draws it here.
Links like [the spec](https://example.com) stay ink; \`inline code\` chips.

1. ordered work reads as a sequence
2. with *emphasis* where it earns it

- unordered work reads as a set
  - one nesting level, circle markers

> A quote steps its ink down one hairline.

| suite | verdict |
| --- | --- |
| pipe-server | clean |

\`\`\`ts
const drained = await server.drainPending(); // then close
\`\`\`
`;

function MarkdownPlayground(): React.JSX.Element {
  const [src, setSrc] = useState(PLAYGROUND_SEED);
  return (
    <Section
      title="markdown · live"
      note="real markdown in, the block vocabulary out — edit the source and watch the render"
    >
      <div className="grid grid-cols-2 gap-3">
        <textarea
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          spellCheck={false}
          aria-label="markdown source"
          className="min-h-105 resize-y rounded-r2 border border-s4 bg-s2 p-3 font-mono text-code leading-[1.6] text-s10 outline-none focus:border-s5"
        />
        <Canvas className="min-h-105 overflow-y-auto">
          <Prose blocks={parseMarkdown(src)} />
        </Canvas>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · streaming                                                        */
/* ------------------------------------------------------------------ */

const STREAM_TEXT =
  'Streaming reveals the trailing block **per word** — each word mounts once and blurs in; completed blocks above it are already settled and never re-animate.';

function StreamedParagraph(): React.JSX.Element {
  const [wordCount, setWordCount] = useState(0);
  const words = STREAM_TEXT.split(' ');
  useEffect(() => {
    if (wordCount >= words.length) return;
    const t = setTimeout(() => setWordCount((c) => c + 1), 60);
    return () => clearTimeout(t);
  }, [wordCount, words.length]);
  const partial = words.slice(0, wordCount).join(' ');
  const done = wordCount >= words.length;
  return (
    <Prose
      blocks={[p('The block above is complete and settled.'), ...(partial ? [p(partial)] : [])]}
      streaming={!done}
    />
  );
}

function StreamingSpec(): React.JSX.Element {
  return (
    <Section
      title="prose · streaming"
      note="completed blocks enter whole (slip-enter) · the trailing block reveals per-word · settle = plain, no re-animate"
    >
      <Canvas>
        <div className="max-w-[65ch]">
          <Replay>
            <StreamedParagraph />
          </Replay>
        </div>
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · code                                                             */
/* ------------------------------------------------------------------ */

const TS_SPECIMEN = `import { connect } from './pipe-client.js';

/** Drain, then close — never the reverse. */
export async function close(server: PipeServer): Promise<void> {
  const pending = server.queue.length; // bytes still in flight
  if (pending > 0) await server.drainPending();
  await closeServer(server);
  server.emit('closed', { pending, at: Date.now() });
}`;

const BASH_SPECIMEN = `pnpm vitest run --project daemon --retry=2
git commit -m "fix: drain pending writes before close" # subject only`;

function CodeSpec(): React.JSX.Element {
  return (
    <Section
      title="code block"
      note="s2 card, s3 hairlines, r2 · header = filename (ink) or bare language (faint) · copy surfaces on hover"
    >
      <Canvas>
        <div className="flex max-w-[65ch] flex-col gap-3">
          <Cap>named — filename leads, language trails faint</Cap>
          <CodeBlock
            code={TS_SPECIMEN}
            lang="ts"
            name="packages/daemon/src/transport/pipe-server.ts"
          />
          <Cap>anonymous fence with a language</Cap>
          <CodeBlock code={BASH_SPECIMEN} lang="bash" />
          <Cap>plain fence — no header at all; copy floats over the corner</Cap>
          <CodeBlock code={'NDJSON frames, one per line\n{"id":1,"verb":"cap.read"}'} lang="text" />
          <Cap>streaming — the caret breathes at the tail</Cap>
          <CodeBlock code={'const drained = await server.drainPending();'} lang="ts" streaming />
        </div>
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · the syntax palette — THE token map                               */
/* ------------------------------------------------------------------ */

const PALETTE: {
  token: string;
  value: string;
  role: string;
  hljs: string;
  onS2: string;
}[] = [
  {
    token: '--color-syn-key',
    value: '#c4907e',
    role: 'keywords · clay',
    hljs: 'hljs-keyword',
    onS2: '6.40',
  },
  {
    token: '--color-syn-str',
    value: '#a3b284',
    role: 'strings · dry moss (yellower than diff-add — a string never reads “added”)',
    hljs: 'hljs-string',
    onS2: '7.76',
  },
  {
    token: '--color-syn-num',
    value: '#cfa763',
    role: 'numbers, literals · dim amber',
    hljs: 'hljs-number · hljs-literal',
    onS2: '7.84',
  },
  {
    token: '--color-syn-type',
    value: '#8ca9d3',
    role: 'types, built-ins · dusty blue',
    hljs: 'hljs-type · hljs-built_in',
    onS2: '7.31',
  },
  {
    token: '--color-syn-fn',
    value: '#d2bd85',
    role: 'function/def names · parchment',
    hljs: 'hljs-title · hljs-function',
    onS2: '9.52',
  },
  {
    token: '--color-syn-punct',
    value: '#878477',
    role: 'punctuation recedes (= s9)',
    hljs: 'hljs-punctuation',
    onS2: '4.69',
  },
  {
    token: '--color-syn-comment',
    value: '#878477',
    role: 'comments · s9 + italic (s8 fails 4.5:1)',
    hljs: 'hljs-comment',
    onS2: '4.69',
  },
  {
    token: '--color-s11',
    value: '#ceccc4',
    role: 'identifiers, params, everything else — ink stays the default',
    hljs: 'hljs (base)',
    onS2: '10.94',
  },
];

function PaletteSpec(): React.JSX.Element {
  return (
    <Section
      title="syntax palette"
      note="lives in the theme file (a theme is one full scale file) · kin to the state hues, calmer · all ≥ 4.5:1 on s1–s3"
    >
      <div className="overflow-hidden rounded-r2 border border-s4">
        {PALETTE.map((row) => (
          <div
            key={row.token + row.hljs}
            className="flex flex-col gap-0.5 border-b border-s3 bg-s2 px-3 py-2 last:border-0"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-3.5 w-3.5 flex-none rounded-r1 border border-s4"
                style={{ background: row.value }}
              />
              <span className="font-mono text-[11px] text-s10">{row.token}</span>
              <span className="font-mono text-[11px]" style={{ color: row.value }}>
                {row.value}
              </span>
              <span className="ml-auto font-mono text-caps text-s7">{row.onS2} : 1 on s2</span>
            </div>
            <div className="flex items-baseline gap-3 pl-6.5">
              <span className="min-w-0 flex-1 text-code text-s9">{row.role}</span>
              <span className="flex-none font-mono text-caps text-s6">{row.hljs}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 max-w-[72ch] text-code leading-relaxed text-s9">
        Hue whispers the grammar; ink carries the code — including inside diffs, where the{' '}
        <b className="text-diff-add">add</b>/<b className="text-diff-del">del</b> reading moves to a
        line-background wash (tokens keep the palette, the line wears the verdict; context rows
        recede by opacity).
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · tool cards                                                       */
/* ------------------------------------------------------------------ */

function tool(view: Extract<Frame, { kind: 'tool' }>['view']): React.JSX.Element {
  return <ToolFrame view={view} onOpenPath={() => undefined} onOpenUrl={() => undefined} />;
}

function ToolSpec(): React.JSX.Element {
  return (
    <Section
      title="tool calls"
      note="ONE container, both states — the header never changes; expanding fades the chrome in and slides the body open · running = blue dot · failure = red dot, rests open · success renders NO dot"
    >
      <TranscriptOverlayHost>
        <Canvas className="relative min-h-50">
          <Cap>running — the only live emphasis</Cap>
          {tool({ tool: 'Read', verb: 'read', target: 'packages/daemon/test/pipe-server.test.ts' })}
          <Cap>settled read — rests collapsed; hover reveals the expand; click opens the card</Cap>
          {tool({
            tool: 'Read',
            verb: 'read',
            target: 'packages/daemon/test/pipe-server.test.ts',
            ok: true,
            meta: '214 lines',
            link: 'path',
            body: {
              t: 'code',
              lang: 'ts',
              text: Array.from({ length: 22 }, (_, i) =>
                i === 0
                  ? "test('close drains pending writes', async () => {"
                  : i === 21
                    ? '});'
                    : `  const step${i} = await harness.step(${i});`,
              ).join('\n'),
            },
          })}
          <Cap>
            the same read, opened — highlighted preview, clamped; “more lines” hands off to the
            overlay (try it)
          </Cap>
          <ToolFrame
            view={{
              tool: 'Read',
              verb: 'read',
              target: 'packages/daemon/test/pipe-server.test.ts',
              ok: true,
              meta: '214 lines',
              link: 'path',
              body: {
                t: 'code',
                lang: 'ts',
                text: Array.from({ length: 22 }, (_, i) =>
                  i === 0
                    ? "test('close drains pending writes', async () => {"
                    : i === 21
                      ? '});'
                      : `  const step${i} = await harness.step(${i});`,
                ).join('\n'),
              },
            }}
            onOpenPath={() => undefined}
            defaultOpen
          />
          <Cap>
            edit — the diff card: the LINE wears the add/del wash, the code keeps its syntax; the
            path links to the editor at :141
          </Cap>
          {tool({
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
          })}
          <Cap>
            failed command — red dot, output stays visible, error tokens marked, tail-clamped from
            the top
          </Cap>
          {tool({
            tool: 'Bash',
            verb: 'ran',
            target: 'pnpm vitest run --project daemon',
            ok: false,
            meta: 'exit 1',
            body: {
              t: 'out',
              text: [
                '⎯⎯ Failed Tests 1 ⎯⎯',
                'FAIL daemon/test/pipe-server.test.ts',
                '  ✕ close drains pending writes (312ms)',
                'AssertionError: promise rejected instead of resolving',
                '  at pipe-server.test.ts:92:31',
                'Error: write EPIPE — connection closed mid-write',
                'Tests: 1 failed · 41 passed',
                'exit code 1',
              ].join('\n'),
            },
          })}
          <Cap>
            search, opened — every hit is a path:line link; the trailing match text stays verbatim
            (rests collapsed: “⌕ drainPending · 3 hits”)
          </Cap>
          <ToolFrame
            view={{
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
                  {
                    path: 'daemon/test/pipe-server.test.ts',
                    line: 88,
                    text: 'drains pending writes',
                  },
                ],
              },
            }}
            onOpenPath={() => undefined}
            defaultOpen
          />
          <Cap>web search, opened — titles link out to the browser; the host trails faint</Cap>
          <ToolFrame
            view={{
              tool: 'WebSearch',
              verb: 'searched',
              target: 'node net server close drain pending writes',
              ok: true,
              meta: '3 results',
              body: {
                t: 'web',
                hits: [
                  {
                    title: 'net.Server.close() does not wait for sockets — Node.js issue #36281',
                    url: 'https://github.com/nodejs/node/issues/36281',
                  },
                  {
                    title: 'Graceful shutdown patterns for Node servers',
                    url: 'https://blog.platformatic.dev/graceful-shutdown',
                  },
                  {
                    title: 'net documentation — Node.js v22',
                    url: 'https://nodejs.org/api/net.html',
                  },
                ],
              },
            }}
            onOpenUrl={() => undefined}
            defaultOpen
          />
          <Cap>
            web fetch — the source URL is the header link (no body — the row is the receipt)
          </Cap>
          <ToolFrame
            view={{
              tool: 'WebFetch',
              verb: 'fetched',
              target: 'https://nodejs.org/api/net.html',
              ok: true,
              meta: '≈4.1k tok',
              link: 'url',
            }}
            onOpenUrl={() => undefined}
          />
          <Cap>
            a bare tool-result (no paired use — defensive) — the same card, the verb carries the
            header; the merged pair and the running one-liner above are the normal shapes
          </Cap>
          <ToolFrame
            view={{
              tool: 'Bash',
              verb: 'result',
              ok: true,
              meta: '≈120 tok',
              body: { t: 'out', text: 'Done in 4.2s using pnpm v11.9.0' },
            }}
          />
          <Cap>run-checks — the verdict body: marks, names, durations, and the summary line</Cap>
          {tool({
            tool: 'run_checks',
            verb: 'checked',
            target: 'transport suite',
            ok: false,
            meta: '6 checks',
            body: {
              t: 'checks',
              checks: [
                { name: 'pipe-server.test.ts', ok: true, ms: 1840 },
                { name: 'pipe-client.test.ts', ok: false, ms: 920 },
                { name: 'framing.test.ts', ok: true, ms: 310 },
                { name: 'typecheck', ok: true, ms: 4100 },
                { name: 'lint', ok: true, ms: 1300 },
                { name: 'docs:check', ok: true, ms: 240 },
              ],
            },
          })}
        </Canvas>
      </TranscriptOverlayHost>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · plan                                                             */
/* ------------------------------------------------------------------ */

function CyclingPlan(): React.JSX.Element {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 5), 1100);
    return () => clearInterval(t);
  }, []);
  const status = (i: number): PlanStatus =>
    i < step ? 'done' : i === step ? 'in-progress' : 'pending';
  return (
    <PlanRow
      items={[
        { text: 'Reproduce the flake under load', status: status(0) },
        { text: 'Drain pending writes before close', status: status(1) },
        { text: 'Strengthen the teardown test', status: status(2) },
        { text: 'Run the transport suite', status: status(3) },
      ]}
    />
  );
}

function PlanSpec(): React.JSX.Element {
  return (
    <Section
      title="plan"
      note="no box — working memory, not output · the › marker is the transcript's one blue element · done recedes, never struck through"
    >
      <Canvas>
        <Cap>resting</Cap>
        <PlanRow
          items={[
            { text: 'Reproduce the flake under load', status: 'done' },
            { text: 'Drain pending writes before close', status: 'in-progress' },
            { text: 'Strengthen the teardown test', status: 'pending' },
            { text: 'Run the transport suite', status: 'pending' },
          ]}
        />
        <Cap>updating in place — statuses ease, progress reads as movement down the list</Cap>
        <CyclingPlan />
        <Cap>settled — all done, the count closes the story</Cap>
        <PlanRow
          items={[
            { text: 'Reproduce the flake under load', status: 'done' },
            { text: 'Drain pending writes before close', status: 'done' },
            { text: 'Strengthen the teardown test', status: 'done' },
            { text: 'Run the transport suite', status: 'done' },
          ]}
        />
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 7 · reasoning                                                        */
/* ------------------------------------------------------------------ */

const THINK_TEXT =
  'The failure clusters around server close while a client write is still queued. If teardown races the drain, the socket dies with bytes in flight — checking the ordering in pipe-server.ts first.';

function StreamedThink(): React.JSX.Element {
  const words = THINK_TEXT.split(' ');
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count >= words.length) return;
    const t = setTimeout(() => setCount((c) => c + 1), 45);
    return () => clearTimeout(t);
  }, [count, words.length]);
  const done = count >= words.length;
  return (
    <ThinkRow
      text={words.slice(0, count).join(' ')}
      streaming={!done}
      durationMs={done ? 12000 : undefined}
    />
  );
}

function ThinkSpec(): React.JSX.Element {
  return (
    <Section
      title="reasoning"
      note="never boxed — an aside · auto-expands while streaming, melts closed on settle · resting line carries the duration"
    >
      <Canvas>
        <Cap>streaming → settle (auto-collapse ~1s after the last word)</Cap>
        <Replay>
          <StreamedThink />
        </Replay>
        <Cap>settled, resting — click to re-expand</Cap>
        <ThinkRow text={THINK_TEXT} durationMs={12000} />
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 8 · subagent                                                         */
/* ------------------------------------------------------------------ */

const NESTED_FRAMES: Frame[] = [
  { kind: 'subagent', id: 'g-sub1', childWorktree: 'wt/test-writer', event: 'spawn' },
  {
    kind: 'think',
    id: 'g-sub2',
    depth: 1,
    text: 'The teardown test needs concurrent writers to expose the race.',
    durationMs: 4000,
  },
  {
    kind: 'tool',
    id: 'g-sub3',
    depth: 1,
    view: {
      tool: 'Edit',
      verb: 'edit',
      target: 'daemon/test/pipe-server.test.ts',
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
          { k: 'add', text: '+ });' },
        ],
      },
    },
  },
  {
    kind: 'subagent',
    id: 'g-sub4',
    childWorktree: 'wt/test-writer',
    event: 'rollup',
    rollup: { tools: 4, tokens: 18200, cost: 0.12, status: 'done' },
  },
];

function SubagentSpec(): React.JSX.Element {
  return (
    <Section
      title="subagents"
      note="lifecycle rows are one-liners · nested work indents behind a hairline rail · the roll-up is the receipt a child leaves behind"
    >
      <Canvas>
        <Cap>every lifecycle event</Cap>
        <SubagentRow childWorktree="wt/test-writer" event="spawn-proposal" />
        <SubagentRow childWorktree="wt/test-writer" event="spawn" />
        <SubagentRow childWorktree="wt/test-writer" event="running" />
        <SubagentRow childWorktree="wt/test-writer" event="idle" />
        <SubagentRow childWorktree="wt/test-writer" event="done" />
        <Cap>the roll-up receipt (and a failed one)</Cap>
        <SubagentRow
          childWorktree="wt/test-writer"
          event="rollup"
          rollup={{ tools: 4, tokens: 18200, cost: 0.12, status: 'done' }}
        />
        <SubagentRow
          childWorktree="wt/fuzzer"
          event="rollup"
          rollup={{ tools: 11, tokens: 52400, cost: 0.31, status: 'failed' }}
        />
        <Cap>depth — a child's frames read as an indented thread</Cap>
        <div className="-m-5">
          <Transcript frames={NESTED_FRAMES} />
        </div>
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 9 · approval                                                         */
/* ------------------------------------------------------------------ */

/** The docked gate, live: approve/deny/redirect it and watch the resolution
 *  land as a receipt where the composer's dock stood. */
function LiveApprovalDock(): React.JSX.Element {
  const [resolved, setResolved] = useState<'approved' | 'denied' | 'redirected' | undefined>(
    undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-56 rounded-r2 border border-s4 bg-s1">
        {resolved === undefined ? (
          <Composer
            running={false}
            approval={{
              id: 'g-appr',
              tool: 'Bash',
              summary: 'pnpm vitest run --project daemon --retry=8',
              diffStat: 'retry ×8',
            }}
            onApprove={() => setResolved('approved')}
            onDeny={() => setResolved('denied')}
            onRedirect={() => setResolved('redirected')}
          />
        ) : (
          <div className="flex flex-col gap-2 p-5">
            <ApprovalRow
              tool="Bash"
              summary="pnpm vitest run --project daemon --retry=8"
              resolved={resolved === 'approved' ? 'approved' : 'denied'}
            />
            {resolved === 'redirected' && (
              <UserRow text="run it once, no retries — chase any flake as a real failure" />
            )}
            <button
              type="button"
              onClick={() => setResolved(undefined)}
              className="slip cursor-pointer self-start font-mono text-caps text-s7 hover:text-s9"
            >
              reset ↻
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalSpec(): React.JSX.Element {
  return (
    <Section
      title="approval"
      note="the gate blocks the input, so it IS the input's top section — one shell, amber edge · the card's halves are the buttons: left denies (⌫), right approves (⏎) · typing redirects instead"
    >
      <Cap>
        pending, merged into the composer — hover a half to see its verdict; click it, or type below
        to redirect (try all three)
      </Cap>
      <LiveApprovalDock />
      <div className="mt-3">
        <Cap>a long command wraps; the halves still cover the whole card</Cap>
        <div className="relative h-72 rounded-r2 border border-s4 bg-s1">
          <Composer
            running={false}
            approval={{
              id: 'g-appr-long',
              tool: 'Bash',
              summary:
                'docker run --rm -v "$(pwd)":/repo -w /repo -e NODE_ENV=production -e CI=1 node:22 bash -lc "pnpm install --frozen-lockfile && pnpm -r build && pnpm vitest run --project daemon --reporter=verbose --retry=2 2>&1 | tee /repo/.logs/ci-$(date +%s).log"',
              diffStat: 'container',
            }}
          />
        </div>
      </div>
      <Canvas className="mt-3">
        <Cap>the receipts, as they land in the transcript</Cap>
        <ApprovalRow tool="Bash" summary="git rm -r docs/superpowers/" resolved="approved" />
        <ApprovalRow tool="Bash" summary="rm -rf node_modules/.cache" resolved="denied" />
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 10 · deny                                                            */
/* ------------------------------------------------------------------ */

function DenySpec(): React.JSX.Element {
  return (
    <Section
      title="deny — the system's only two stops"
      note="SC-1: firm, legible, a reason and a way forward · full measure · the dot is the only red · no fill, no modal, no scold"
    >
      <Canvas>
        <DenyRow
          denyKind="cost-cap"
          reason="Session spend reached $5.00 — the cap you set. Nothing was lost; the turn is paused, not discarded."
        />
        <DenyRow
          denyKind="close-gate"
          reason="2 critical flags are open against this change — the session can't close over them."
        />
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 11 · error · note                                                    */
/* ------------------------------------------------------------------ */

function ErrorNoteSpec(): React.JSX.Element {
  return (
    <Section
      title="errors · notes"
      note="an error is information, not an alarm — one line, the mark + origin chip classify it · a note is neither voice"
    >
      <Canvas>
        <ErrorRow message="write EPIPE — the daemon connection dropped mid-push" origin="daemon" />
        <ErrorRow
          message="tree-sitter grammar for .svelte not installed — falling back to the spec tier"
          origin="tool"
        />
        <ErrorRow message="rate-limited by the provider; backing off 30s" origin="loop" />
        <ErrorRow message="an error with no origin still reads the same" />
        <NoteRow text="Request interrupted by user" />
        <NoteRow text="Switched model to fable-5" />
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 12 · raw                                                             */
/* ------------------------------------------------------------------ */

const RAW_SOURCE: Frame[] = [
  { kind: 'user', id: 'g-r1', text: 'Fix the flaky pipe test.' },
  {
    kind: 'think',
    id: 'g-r2',
    text: 'The failure clusters around server close while a write is queued…',
    durationMs: 8000,
  },
  {
    kind: 'tool',
    id: 'g-r3',
    view: {
      tool: 'Read',
      verb: 'read',
      target: 'daemon/test/pipe-server.test.ts',
      ok: true,
      meta: '214 lines',
    },
  },
  { kind: 'text', id: 'g-r4', blocks: [p('The race is in close() — draining first fixes it.')] },
];

function RawSpec(): React.JSX.Element {
  return (
    <Section
      title="raw mode"
      note="D85 — the mask comes off: verbatim loop lines, plain mono, no cards, no reveal, no interpretation (the shell owns the amber indicator)"
    >
      <Canvas>
        <Cap>the governed view above · the same turn, raw, below</Cap>
        <div className="flex flex-col gap-3 border-b border-s3 pb-3.5">
          <UserRow text="Fix the flaky pipe test." />
          <ThinkRow
            text="The failure clusters around server close while a write is queued…"
            durationMs={8000}
          />
        </div>
        <div className="flex flex-col">
          {rawProjection(RAW_SOURCE).map((ln, i) => (
            <RawRow key={i} text={ln} />
          ))}
        </div>
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 13 · empty                                                           */
/* ------------------------------------------------------------------ */

function EmptySpec(): React.JSX.Element {
  return (
    <Section
      title="empty conversation"
      note="a fresh session teaches the register in three quiet lines: who is ready, on what, how to speak"
    >
      <Canvas className="h-64 justify-center">
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <span aria-hidden className="font-mono text-[26px] text-s5">
            ❯
          </span>
          <div className="text-body text-s9">
            <b className="font-[550] text-s10">builder</b> is ready
          </div>
          <div className="font-mono text-meta text-s6">fable-5 · high · ask edits</div>
        </div>
      </Canvas>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 14 · composer                                                        */
/* ------------------------------------------------------------------ */

function ComposerState({
  cap,
  height = 'h-28',
  ...props
}: {
  cap: string;
  height?: string;
} & React.ComponentProps<typeof Composer>): React.JSX.Element {
  return (
    <div>
      <Cap>{cap}</Cap>
      <div className={cx('relative overflow-visible rounded-r2 border border-s4 bg-s1', height)}>
        <Composer {...props} />
      </div>
    </div>
  );
}

function ComposerSpec(): React.JSX.Element {
  return (
    <Section
      title="composer states"
      note="search-field skin (s3 · s5 hairline) · the shell edge IS the session's status: tinted border + two soft comets shimmering the whole path (blue running · amber gated), nothing at rest"
    >
      <div className="flex flex-col gap-4">
        <ComposerState
          cap="resting, with text — ⏎ sends · no status on the edge"
          running={false}
          defaultText="run the transport suite again"
        />
        <ComposerState
          cap="multi-line — the field grows with its content to ~6 lines, then scrolls (⇧⏎ breaks the line)"
          height="h-48"
          running={false}
          defaultText={
            'Three things before you close this out:\n1. re-run the suite with the retry flag off\n2. check the client reconnect path under the same load\n3. note the drain-then-close rule in the transport README'
          }
        />
        <ComposerState
          cap="running, nothing typed — the blue comets shimmer the border (reduced-motion: tint only); Stop is the only action (esc)"
          running
        />
        <ComposerState
          cap="running, with text — queue waits for the turn's end (⏎) vs barge in now (⌥⏎), labeled, never a mystery"
          running
          defaultText="also check the client reconnect path"
        />
        <ComposerState
          cap="queued messages pin above the shell — removable, released FIFO at turn end"
          height="h-60"
          running
          queued={[
            { id: 'q1', text: 'also check the client reconnect path' },
            { id: 'q2', text: 'then update the transport README' },
          ]}
        />
        <ComposerState cap="no session — everything rests" running={false} disabled />
      </div>
    </Section>
  );
}

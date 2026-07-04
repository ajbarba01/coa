/**
 * Design-gate showcase for the chat-interface overhaul (spec item 5 / Phase 0).
 * The transcript rows are the REAL `TranscriptRow` kit member driven by sample
 * `TranscriptFrame` data (nothing drives the daemon), so the specimens reflect
 * the refined design by construction — no gutter, dotted/solid spines, larger
 * approval buttons. The composer is now the REAL `Composer` kit member too —
 * idle and running specimens, driven by no daemon.
 */
import {
  Composer,
  IconButton,
  Markdown,
  Select,
  TranscriptRow,
  cx,
  type TranscriptFrame,
} from '@coa/console-ui';
import { Maximize2 } from 'lucide-react';
import { Family, Row } from './Specimen.js';
import { CompactToolLine } from './toolblocks/CompactToolLine.js';
import { GroupedActivityLog } from './toolblocks/GroupedActivityLog.js';
import { RichToolCard } from './toolblocks/RichToolCard.js';
import { TOOL_CALLS } from './toolblocks/samples.js';

const noop = (): void => {};

/** Real GFM exercised by the live `Markdown` specimen: heading, bullet + task
 *  list, table, inline code, a link, an emoji, and a fenced TypeScript block
 *  (which drives CodeBlock + its CopyButton). */
const MARKDOWN_SAMPLE = `### Rotating the refresh token 🔐

I'll route failures through \`AuthError\` and keep the old token single-use. Steps:

- swap the imports in \`src/auth.ts\`
- [x] mint a fresh token
- [ ] invalidate the previous one

| step | status |
| --- | --- |
| mint | done |
| invalidate | pending |

See the [token helper docs](https://x.test/tokens) for the scope contract.

\`\`\`ts
export async function refreshToken(session: Session): Promise<Token> {
  // rotate the refresh token; the old one is single-use
  const next = await mint(session.userId, { scope: session.scope });
  if (!next.ok) throw new AuthError('mint failed', { cause: next.error });
  return next.token;
}
\`\`\``;

/* -------------------------------------------------------------------------- */
/* Shared block scaffolding — a role gutter + indent/spine, token-styled only. */
/* -------------------------------------------------------------------------- */

type Role = 'you' | 'agent' | 'subagent';

/** A labelled block row: fixed role gutter + content column, matching the live
 *  Transcript's gutter idiom. `spine` draws the depth-1 subagent left rail. */
function Block({
  role,
  spine = false,
  children,
}: {
  role: Role;
  spine?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={cx('flex gap-3 px-3 py-2', spine && 'ml-4 border-l border-hairline pl-4')}>
      <span
        className={cx(
          'w-14 shrink-0 pt-0.5 text-eyebrow uppercase tracking-[0.06em]',
          role === 'subagent' ? 'text-faint' : 'text-muted',
        )}
      >
        {role}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The frame each specimen sits in — one bordered surface reading as the transcript. */
function Stream({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="w-full max-w-2xl divide-y divide-hairline rounded-surface border border-hairline bg-surface">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* (a)+(b)+(c) Real TranscriptRow specimens — one row per frame kind, driven   */
/* by sample TranscriptFrame data so the showcase reflects the refined design */
/* (no gutter, dotted/solid spines, larger approval buttons) by construction. */
/* -------------------------------------------------------------------------- */

const SPECIMEN_FRAMES: TranscriptFrame[] = [
  {
    id: 'you-1',
    role: 'you',
    kind: 'text',
    text: 'Refactor the auth module to use the new token helper, and keep `refreshToken` single-use.',
  },
  {
    id: 'agent-md-1',
    role: 'agent',
    kind: 'text',
    text: MARKDOWN_SAMPLE,
  },
  {
    id: 'thinking-1',
    role: 'agent',
    kind: 'thinking',
    text: 'The helper mints a fresh token, so the old refresh token must be invalidated to stay single-use. I will thread the scope through and fail closed on a mint error.',
  },
  {
    id: 'tool-use-1',
    role: 'agent',
    kind: 'tool-use',
    tool: 'read_file',
    input: '{\n  "path": "src/auth.ts",\n  "range": [1, 40]\n}',
  },
  {
    id: 'tool-result-1',
    role: 'agent',
    kind: 'tool-result',
    tool: 'read_file',
    output: 'export function refreshToken(session) {\n  /* … */\n}',
    ok: true,
  },
  {
    id: 'plan-1',
    role: 'agent',
    kind: 'plan',
    items: [
      { text: 'Swap the token imports in src/auth.ts', status: 'done' },
      { text: 'Make the old refresh token single-use', status: 'in-progress' },
      { text: 'Update the auth unit tests', status: 'pending' },
    ],
  },
  {
    id: 'error-1',
    role: 'agent',
    kind: 'error',
    message: 'Tool failed: run_tests exited 1 — 2 assertions failed in auth.test.ts.',
    origin: 'tool',
  },
  {
    id: 'subagent-1',
    kind: 'subagent',
    childWorktree: 'reviewer',
    event: 'rollup',
    rollup: { tools: 4, tokens: 2100, cost: 0.04, status: 'done' },
  },
  {
    id: 'subagent-child-1',
    role: 'subagent',
    kind: 'text',
    text: 'Reviewing the diff — the rotation looks correct, but the error path is untested.',
    depth: 1,
  },
  {
    id: 'approval-1',
    kind: 'approval',
    requestId: 'r-1',
    tool: 'write_file',
    summary: 'src/auth.ts',
    diffStat: '+3 −1',
  },
];

function TranscriptSpecimens(): React.JSX.Element {
  return (
    <div className="w-full max-w-2xl divide-y divide-hairline rounded-surface border border-hairline bg-surface">
      {SPECIMEN_FRAMES.map((frame) => (
        <TranscriptRow key={frame.id} frame={frame} onRespond={noop} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* (d) Composer — live kit member, idle + running specimens.                  */
/* -------------------------------------------------------------------------- */

/** The model/effort selects a real host (ChatPanel, Task 12) passes into
 *  `slotStart` — shown here for realism, not part of the Composer itself. */
function ModelEffortSlot(): React.JSX.Element {
  return (
    <>
      <Select
        label="Model"
        defaultValue="opus"
        options={[
          { value: 'opus', label: 'Opus 4.8' },
          { value: 'sonnet', label: 'Sonnet 5' },
        ]}
      />
      <Select
        label="Effort"
        defaultValue="high"
        options={[
          { value: 'low', label: 'low' },
          { value: 'medium', label: 'medium' },
          { value: 'high', label: 'high' },
        ]}
      />
    </>
  );
}

const expandSlot = (
  <IconButton icon={Maximize2} label="Expand composer" variant="tertiary" size="sm" />
);

/** Two live `Composer` specimens — idle (Send enabled) and `running` (Stop
 *  shown) — so both states of the send/stop toggle are reviewable as-built. */
function ComposerSpecimens(): React.JSX.Element {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <div className="rounded-surface border border-border-default bg-surface">
        <Composer onSend={noop} slotStart={<ModelEffortSlot />} slotEnd={expandSlot} />
      </div>
      <div className="rounded-surface border border-border-default bg-surface">
        <Composer
          onSend={noop}
          onInterrupt={noop}
          running
          slotStart={<ModelEffortSlot />}
          slotEnd={expandSlot}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Live Markdown — real GFM through the kit's `Markdown` member.              */
/* -------------------------------------------------------------------------- */

/** The live `Markdown` specimen framed as a transcript surface, so the prose,
 *  table, task list, and fenced CodeBlock (with its CopyButton) are reviewable
 *  exactly as they render in the chat. */
function LiveMarkdown(): React.JSX.Element {
  return (
    <Stream>
      <Block role="agent">
        <Markdown source={MARKDOWN_SAMPLE} />
      </Block>
    </Stream>
  );
}

/* -------------------------------------------------------------------------- */
/* Tool blocks (design gate) — three directions over one shared sample set     */
/* spanning both Claude and coa tools.                                         */
/* -------------------------------------------------------------------------- */

/** A bordered transcript-like frame that stacks tool-block specimens. */
function ToolBlockFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-1 rounded-surface border border-hairline bg-surface p-2">
      {children}
    </div>
  );
}

function CompactDirection(): React.JSX.Element {
  return (
    <ToolBlockFrame>
      {TOOL_CALLS.map((call) => (
        <CompactToolLine key={call.id} call={call} />
      ))}
    </ToolBlockFrame>
  );
}

function GroupedDirection(): React.JSX.Element {
  return (
    <ToolBlockFrame>
      <GroupedActivityLog calls={TOOL_CALLS} />
    </ToolBlockFrame>
  );
}

function RichDirection(): React.JSX.Element {
  return (
    <ToolBlockFrame>
      {TOOL_CALLS.map((call) => (
        <RichToolCard key={call.id} call={call} />
      ))}
    </ToolBlockFrame>
  );
}

export function ChatMockupsSection(): React.JSX.Element {
  return (
    <>
      <Family name="Chat mockups (design gate)">
        <Row label="Transcript rows" align="start">
          <TranscriptSpecimens />
        </Row>
        <Row label="Composer" align="start">
          <ComposerSpecimens />
        </Row>
        <Row label="Live markdown" align="start">
          <LiveMarkdown />
        </Row>
      </Family>
      <Family name="Tool blocks (design gate)">
        <Row label="1 · Compact line" align="start">
          <CompactDirection />
        </Row>
        <Row label="2 · Grouped log" align="start">
          <GroupedDirection />
        </Row>
        <Row label="3 · Rich card" align="start">
          <RichDirection />
        </Row>
      </Family>
    </>
  );
}

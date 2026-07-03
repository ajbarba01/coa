/**
 * Static, non-interactive design mockups for the chat-interface overhaul (design
 * gate — spec item 5 / Phase 0). Everything here is hardcoded data rendered with
 * `@coa/console-ui` kit components + semantic tokens only; nothing drives the
 * daemon and nothing wires into the real ChatPanel/Transcript. The maintainer
 * reviews these specimens (block kinds, subagent nesting, approval card, composer)
 * plus the live `Markdown` renderer before any panel wiring begins.
 */
import { useState } from 'react';
import {
  Badge,
  Button,
  ButtonGroup,
  Code,
  Icon,
  IconButton,
  Markdown,
  Select,
  cx,
} from '@coa/console-ui';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  Maximize2,
  Send,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { Family, Row } from './Specimen.js';

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
/* Block kinds (a) — you / agent markdown / thinking / tool / plan / error.   */
/* -------------------------------------------------------------------------- */

function YouText(): React.JSX.Element {
  return (
    <Block role="you">
      <p className="text-body leading-[1.5] text-fg">
        Refactor the auth module to use the new token helper, and keep <Code>refreshToken</Code>{' '}
        single-use.
      </p>
    </Block>
  );
}

/** Agent markdown prose specimen — the live `Markdown` kit member rendering real
 *  GFM (heading, list, task list, table, inline code, link, emoji, fenced code).
 *  The fenced block exercises CodeBlock + its CopyButton. */
function AgentMarkdown(): React.JSX.Element {
  return (
    <Block role="agent">
      <Markdown source={MARKDOWN_SAMPLE} />
    </Block>
  );
}

function Thinking(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Block role="agent">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-caption text-faint hover:text-muted"
      >
        <Icon name={open ? ChevronDown : ChevronRight} size={14} />
        <span className="uppercase tracking-[0.06em]">Thinking</span>
      </button>
      {open && (
        <p className="mt-1.5 border-l border-hairline pl-3 text-label italic leading-[1.5] text-muted">
          The helper mints a fresh token, so the old refresh token must be invalidated to stay
          single-use. I&apos;ll thread the scope through and fail closed on a mint error.
        </p>
      )}
    </Block>
  );
}

/** Tool call: a one-line collapsed card that expands to args (byte-faithful). */
function ToolUse({ defaultOpen }: { defaultOpen: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Block role="agent">
      <div className="rounded-surface border border-hairline bg-subtle">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-label"
        >
          <Icon name={open ? ChevronDown : ChevronRight} size={14} className="text-faint" />
          <span className="font-medium text-fg">read_file</span>
          <span className="min-w-0 flex-1 truncate text-left text-muted">src/auth.ts</span>
          <Icon name={Check} size={14} label="succeeded" className="text-success" />
        </button>
        {open && (
          <div className="border-t border-hairline p-2">
            <Code block>{'{\n  "path": "src/auth.ts",\n  "range": [1, 40]\n}'}</Code>
          </div>
        )}
      </div>
    </Block>
  );
}

interface TodoItem {
  id: string;
  label: string;
  state: 'done' | 'active' | 'pending';
}
const PLAN_ITEMS: TodoItem[] = [
  { id: '1', label: 'Swap the token imports in src/auth.ts', state: 'done' },
  { id: '2', label: 'Make the old refresh token single-use', state: 'active' },
  { id: '3', label: 'Update the auth unit tests', state: 'pending' },
];
const planGlyph = { done: Check, active: Loader2, pending: Circle } as const;
const planTone = { done: 'text-success', active: 'text-accent', pending: 'text-faint' } as const;

function Plan(): React.JSX.Element {
  return (
    <Block role="agent">
      <div className="rounded-surface border border-hairline bg-subtle p-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">Plan</span>
          <span className="text-caption text-muted">1 of 3 done</span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {PLAN_ITEMS.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-label">
              <Icon
                name={planGlyph[item.state]}
                size={14}
                className={cx(planTone[item.state], item.state === 'active' && 'animate-spin')}
              />
              <span
                className={cx(
                  item.state === 'done' ? 'text-muted line-through' : 'text-fg',
                  item.state === 'pending' && 'text-muted',
                )}
              >
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Block>
  );
}

function ToolResult(): React.JSX.Element {
  return (
    <Block role="agent">
      <div className="flex flex-col gap-1">
        <span className="text-caption text-muted">read_file · ok</span>
        <Code block>{'export function refreshToken(session) {\n  /* … */\n}'}</Code>
      </div>
    </Block>
  );
}

function ErrorBlock(): React.JSX.Element {
  return (
    <Block role="agent">
      <div className="flex items-start gap-2 rounded-surface border border-danger bg-danger-tint px-2.5 py-2">
        <Icon name={TriangleAlert} size={16} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 text-label leading-[1.5] text-danger-text">
          <span className="font-medium">Tool failed:</span> <Code>run_tests</Code> exited 1 — 2
          assertions failed in <Code>auth.test.ts</Code>.
        </div>
      </div>
    </Block>
  );
}

function BlockKindStack(): React.JSX.Element {
  return (
    <Stream>
      <YouText />
      <AgentMarkdown />
      <Thinking />
      <ToolUse defaultOpen={false} />
      <ToolUse defaultOpen />
      <Plan />
      <ToolResult />
      <ErrorBlock />
    </Stream>
  );
}

/* -------------------------------------------------------------------------- */
/* (b) Subagent nesting (depth-1) + parent roll-up chip.                      */
/* -------------------------------------------------------------------------- */

/** The roll-up chip carried on the parent spawn frame: tools · tokens · $ · status.
 *  Never brass (that is the system accent); a subagent reads as neutral/quiet. */
function RollupChip(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 rounded-control border border-hairline bg-subtle px-2 py-0.5 text-caption text-muted">
      <span className="font-medium text-fg">reviewer</span>
      <span aria-hidden className="text-faint">
        ·
      </span>
      <span>4 tools</span>
      <span aria-hidden className="text-faint">
        ·
      </span>
      <span className="tabular-nums">2.1k tok</span>
      <span aria-hidden className="text-faint">
        ·
      </span>
      <span className="tabular-nums">$0.04</span>
      <Badge tone="success">done</Badge>
    </span>
  );
}

function SubagentNest(): React.JSX.Element {
  return (
    <Stream>
      <Block role="agent">
        <div className="flex flex-col gap-1.5">
          <span className="text-body leading-[1.5] text-fg">
            Spawning a reviewer subagent to check the diff.
          </span>
          <RollupChip />
        </div>
      </Block>
      <Block role="subagent" spine>
        <p className="text-label leading-[1.5] text-muted">
          Reviewing the diff — the rotation looks correct, but the error path is untested.
        </p>
      </Block>
      <Block role="subagent" spine>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-faint">grep · ok</span>
          <Code block>{'src/auth.test.ts: no case for the mint-failure branch'}</Code>
        </div>
      </Block>
    </Stream>
  );
}

/* -------------------------------------------------------------------------- */
/* (c) Diff-led approval card + once/session/tool-pattern scope grants.       */
/* -------------------------------------------------------------------------- */

const DIFF_LINES: { sign: '+' | '-' | ' '; text: string }[] = [
  { sign: ' ', text: 'export async function refreshToken(session: Session) {' },
  { sign: '-', text: '  return mint(session.userId);' },
  { sign: '+', text: '  const next = await mint(session.userId, { scope: session.scope });' },
  { sign: '+', text: "  if (!next.ok) throw new AuthError('mint failed');" },
  { sign: '+', text: '  return next.token;' },
  { sign: ' ', text: '}' },
];
const diffTone = {
  '+': 'bg-success-tint text-success-text',
  '-': 'bg-danger-tint text-danger-text',
  ' ': 'text-muted',
} as const;

function ApprovalCard(): React.JSX.Element {
  return (
    <div className="w-full max-w-2xl rounded-surface border border-border-default bg-raised p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">Approval</span>
        <span className="font-medium text-fg">write_file</span>
        <Code>src/auth.ts</Code>
        <span className="ml-auto text-caption text-faint tabular-nums">+3 −1</span>
        <Badge tone="warning">edit</Badge>
      </div>
      {/* Diff leads the card (§6): the real change, byte-faithful, before the controls. */}
      <div className="overflow-hidden rounded-control border border-hairline bg-base font-mono text-caption leading-[1.55]">
        {DIFF_LINES.map((line, i) => (
          <div key={i} className={cx('flex whitespace-pre px-2', diffTone[line.sign])}>
            <span aria-hidden className="w-4 shrink-0 select-none text-faint">
              {line.sign === ' ' ? '' : line.sign}
            </span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-caption text-muted">Allow this edit</span>
        <ButtonGroup label="Approval scope">
          <Button variant="primary" size="sm" onClick={noop}>
            Once
          </Button>
          <Button variant="secondary" size="sm" onClick={noop}>
            This session
          </Button>
          <Button variant="secondary" size="sm" onClick={noop}>
            All write_file
          </Button>
        </ButtonGroup>
        <Button variant="tertiary" size="sm" className="ml-auto" onClick={noop}>
          Deny
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* (d) Composer — multiline + send/stop + model/effort + expand.             */
/* -------------------------------------------------------------------------- */

function Composer(): React.JSX.Element {
  const [running, setRunning] = useState(false);
  return (
    <div className="w-full max-w-2xl rounded-surface border border-border-default bg-surface focus-within:border-accent">
      <textarea
        rows={3}
        defaultValue="Make the refresh token single-use and add a test for the mint-failure branch."
        aria-label="Message the agent"
        className="block w-full resize-none rounded-t-surface bg-transparent px-3 py-2.5 text-body leading-[1.5] text-fg placeholder:text-faint focus:outline-none"
      />
      <div className="flex items-center gap-2 border-t border-hairline px-2 py-1.5">
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
        <IconButton
          icon={Maximize2}
          label="Expand composer"
          variant="tertiary"
          size="sm"
          className="ml-auto"
        />
        {running ? (
          <Button variant="danger" size="sm" onClick={() => setRunning(false)}>
            <Icon name={Square} size={14} />
            Stop
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setRunning(true)}>
            <Icon name={Send} size={14} />
            Send
          </Button>
        )}
      </div>
      <p className="px-3 pb-1.5 text-eyebrow text-faint">
        Enter to send · Shift+Enter for a newline · Esc to interrupt
      </p>
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

export function ChatMockupsSection(): React.JSX.Element {
  return (
    <Family name="Chat mockups (design gate)">
      <Row label="Block kinds" align="start">
        <BlockKindStack />
      </Row>
      <Row label="Subagent nest" align="start">
        <SubagentNest />
      </Row>
      <Row label="Approval card" align="start">
        <ApprovalCard />
      </Row>
      <Row label="Composer" align="start">
        <Composer />
      </Row>
      <Row label="Live markdown" align="start">
        <LiveMarkdown />
      </Row>
    </Family>
  );
}

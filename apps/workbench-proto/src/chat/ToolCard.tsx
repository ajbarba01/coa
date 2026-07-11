import { StatusDot, cx } from '@coa/console-kit';
import { useState } from 'react';
import { CodeLine } from './CodeBlock.js';
import type { ToolBody, ToolView } from './model.js';
import { errorSpans, tokenize } from './model.js';
import { useTranscriptOverlay } from './overlay.js';

/** Mono glyph per tool family — the transcript's terminal shorthand. */
export function toolGlyph(tool: string): string {
  switch (tool) {
    case 'Read':
      return 'R';
    case 'Edit':
      return 'E';
    case 'Write':
      return 'W';
    case 'Bash':
      return '$';
    case 'Grep':
    case 'Glob':
      return '⌕';
    case 'WebSearch':
    case 'WebFetch':
      return '◍';
    case 'run_checks':
      return '✓';
    default:
      return '·';
  }
}

/** Reads/searches rest closed; edits, writes, commands, checks and every
 *  failure rest open. */
const RESTS_COLLAPSED = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);

/** Body lines shown inline before the clamp hands off to the overlay. */
const CLAMP = 8;

/** The tool call, full anatomy — ONE container for both states. The header
 *  row is byte-identical closed and open; expanding only fades the card
 *  chrome in and slides the body open beneath it, so the change reads as
 *  "the result appears", never as a different component.
 *
 *  State vocabulary (indicator law, quiet register): RUNNING earns the blue
 *  dot; FAILURE earns the red dot and its output is always visible (it rests
 *  open); SUCCESS renders no dot at all. */
export function ToolFrame({
  view,
  onOpenPath,
  onOpenUrl,
  defaultOpen,
}: {
  view: ToolView;
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
  onOpenUrl?: ((url: string) => void) | undefined;
  /** Showcase seam: pin the open state regardless of the tool's resting rule. */
  defaultOpen?: boolean | undefined;
}): React.JSX.Element {
  const running = view.ok === undefined;
  const failed = view.ok === false;
  const [open, setOpen] = useState(defaultOpen ?? (!RESTS_COLLAPSED.has(view.tool) || failed));
  const [inlineFull, setInlineFull] = useState(false);
  const overlay = useTranscriptOverlay();

  const hasBody = !running && view.body !== undefined;
  const shown = open && hasBody;

  const expandFull = (): void => {
    const title = `${view.verb} ${view.target ?? ''}`.trim();
    if (overlay !== null && view.body !== undefined) {
      overlay.open({
        title,
        meta: view.meta,
        node: (
          <div className="px-1 py-1">
            <ToolBodyView
              body={view.body}
              failed={failed}
              full
              onOpenPath={onOpenPath}
              onOpenUrl={onOpenUrl}
            />
          </div>
        ),
      });
    } else setInlineFull(true);
  };

  return (
    <div
      className={cx(
        'slip -mx-2.5 min-w-0 overflow-hidden rounded-r2 border',
        shown ? 'border-s3 bg-s2' : 'border-transparent',
      )}
    >
      {/* the header — identical in both states; toggles when a body exists */}
      <div
        className={cx(
          'group flex items-center gap-2 px-2.5 py-1.5 font-mono text-code',
          hasBody && 'slip cursor-pointer hover:bg-s2',
        )}
        {...(hasBody
          ? {
              role: 'button' as const,
              tabIndex: 0,
              'aria-expanded': shown,
              onClick: () => setOpen((v) => !v),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              },
            }
          : {})}
      >
        <span className="w-3 flex-none text-center text-s7">{toolGlyph(view.tool)}</span>
        {running && <StatusDot status="running" size={5} />}
        <span className="flex-none text-s8">{view.verb}</span>
        {view.target !== undefined &&
          (view.link === 'path' && onOpenPath !== undefined ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPath(view.target ?? '', view.line);
              }}
              title="reveal in editor"
              className="slip min-w-0 cursor-pointer truncate text-left text-s11 underline decoration-s5 decoration-dotted underline-offset-[3px] hover:text-s12 hover:decoration-s7"
            >
              {view.target}
              {view.line !== undefined && <span className="text-s8">:{view.line}</span>}
            </button>
          ) : view.link === 'url' && onOpenUrl !== undefined ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenUrl(view.target ?? '');
              }}
              title="open in browser"
              className="slip min-w-0 cursor-pointer truncate text-left text-s11 underline decoration-s5 decoration-dotted underline-offset-[3px] hover:text-s12 hover:decoration-s7"
            >
              {view.target}
            </button>
          ) : (
            <span className="min-w-0 truncate text-s11">{view.target}</span>
          ))}
        <span className="ml-auto flex flex-none items-center gap-2 pl-2">
          {view.meta !== undefined && <DiffStat meta={view.meta} />}
          {failed && <StatusDot status="critical" size={5} />}
          {hasBody && (
            <span
              aria-hidden
              className={cx(
                'slip-move inline-block text-[9px] text-s6',
                shown ? 'rotate-180' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              ⌄
            </span>
          )}
        </span>
      </div>
      {/* the body slides open under the header (the only thing that changes) */}
      <div
        className="grid transition-[grid-template-rows] duration-[var(--dur-move)] ease-[var(--ease-slip)] motion-reduce:transition-none"
        style={{ gridTemplateRows: shown ? '1fr' : '0fr' }}
        aria-hidden={shown ? undefined : true}
      >
        <div className="min-h-0 overflow-hidden">
          {view.body !== undefined && (
            <div className="border-t border-s3">
              <ToolBodyView
                body={view.body}
                failed={failed}
                full={inlineFull}
                onExpand={expandFull}
                onOpenPath={onOpenPath}
                onOpenUrl={onOpenUrl}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** `+9 −3` metas split into diff tints; anything else renders faint mono. */
function DiffStat({ meta }: { meta: string }): React.JSX.Element {
  const m = /^\+(\d+) −(\d+)$/.exec(meta);
  if (m === null) return <span className="text-meta whitespace-nowrap text-s7">{meta}</span>;
  return (
    <span className="text-meta whitespace-nowrap">
      <span className="text-diff-add">+{m[1]}</span> <span className="text-diff-del">−{m[2]}</span>
    </span>
  );
}

/** One diff line: the LINE carries the add/del tint as a background wash, the
 *  marker keeps the tint as ink, and the code keeps its full syntax coloring
 *  (maintainer ruling — line-highlight over text-tint). Context rows recede
 *  by opacity, hue intact. */
function DiffLine({
  k,
  text,
  lang,
}: {
  k: 'add' | 'del' | 'ctx';
  text: string;
  lang: Parameters<typeof tokenize>[1];
}): React.JSX.Element {
  const marker = k === 'ctx' ? undefined : text.charAt(0);
  const rest = k === 'ctx' ? text : text.slice(1);
  return (
    <div
      className={cx(
        'px-3 whitespace-pre',
        k === 'add' && 'bg-diff-add/12',
        k === 'del' && 'bg-diff-del/12',
        k === 'ctx' && 'opacity-60',
      )}
    >
      {marker !== undefined && (
        <span className={k === 'add' ? 'text-diff-add' : 'text-diff-del'}>{marker}</span>
      )}
      {tokenize(rest, lang).map((t, i) => (
        <span key={i} className={SYNTAX[t.cls]}>
          {t.text}
        </span>
      ))}
    </div>
  );
}

// Local mirror of CodeBlock's SYNTAX_CLASS (imported there for blocks; diffs
// need it per-token here).
const SYNTAX: Record<ReturnType<typeof tokenize>[number]['cls'], string> = {
  key: 'text-syn-key',
  str: 'text-syn-str',
  num: 'text-syn-num',
  type: 'text-syn-type',
  fn: 'text-syn-fn',
  punct: 'text-syn-punct',
  comment: 'text-syn-comment italic',
  plain: 'text-s11',
};

function ToolBodyView({
  body,
  failed,
  full = false,
  onExpand,
  onOpenPath,
  onOpenUrl,
}: {
  body: ToolBody;
  failed: boolean;
  full?: boolean;
  onExpand?: (() => void) | undefined;
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
  onOpenUrl?: ((url: string) => void) | undefined;
}): React.JSX.Element {
  switch (body.t) {
    case 'diff': {
      const lines = full ? body.lines : body.lines.slice(0, CLAMP);
      return (
        <>
          <div className="overflow-x-auto py-1 font-mono text-[11px] leading-[1.65]">
            {lines.map((d, i) => (
              <DiffLine key={i} k={d.k} text={d.text} lang={body.lang} />
            ))}
          </div>
          {!full && body.lines.length > CLAMP && (
            <ClampRow hidden={body.lines.length - CLAMP} onExpand={onExpand} />
          )}
        </>
      );
    }
    case 'code': {
      const all = body.text.split('\n');
      const lines = full ? all : all.slice(0, CLAMP);
      return (
        <>
          <div className="overflow-x-auto px-3 py-1.5 font-mono text-[11px] leading-[1.65] whitespace-pre">
            {lines.map((ln, i) => (
              <CodeLine key={i} line={ln} lang={body.lang} />
            ))}
          </div>
          {!full && all.length > CLAMP && (
            <ClampRow hidden={all.length - CLAMP} onExpand={onExpand} />
          )}
        </>
      );
    }
    case 'out': {
      // Command output clamps FROM THE END — the tail is where the verdict
      // lives. A failure's output is always shown, error tokens marked.
      const all = body.text.split('\n');
      const lines = full ? all : all.slice(Math.max(0, all.length - CLAMP));
      const skipped = all.length - lines.length;
      return (
        <>
          {!full && skipped > 0 && <ClampRow hidden={skipped} onExpand={onExpand} leading />}
          <div
            className={cx(
              'overflow-x-auto px-3 py-1.5 font-mono text-[11px] leading-[1.65] whitespace-pre',
              failed ? 'text-s10' : 'text-s8',
            )}
          >
            {lines.map((ln, i) => (
              <div key={i}>
                {errorSpans(ln).map((s, j) => (
                  <span key={j} className={s.err ? 'font-[550] text-crit' : undefined}>
                    {s.text}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </>
      );
    }
    case 'matches': {
      const hits = full ? body.hits : body.hits.slice(0, CLAMP);
      return (
        <>
          <div className="overflow-x-auto py-1 font-mono text-[11px] leading-[1.65]">
            {hits.map((h, i) => (
              <div key={i} className="flex gap-2 px-3 whitespace-pre">
                {onOpenPath !== undefined ? (
                  <button
                    type="button"
                    onClick={() => onOpenPath(h.path, h.line)}
                    className="slip cursor-pointer text-s10 underline decoration-s5 decoration-dotted underline-offset-[3px] hover:text-s12 hover:decoration-s7"
                  >
                    {h.path}
                    {h.line !== undefined && `:${h.line}`}
                  </button>
                ) : (
                  <span className="text-s10">
                    {h.path}
                    {h.line !== undefined && `:${h.line}`}
                  </span>
                )}
                {h.text !== undefined && <span className="truncate text-s7">{h.text}</span>}
              </div>
            ))}
          </div>
          {!full && body.hits.length > CLAMP && (
            <ClampRow hidden={body.hits.length - CLAMP} onExpand={onExpand} />
          )}
        </>
      );
    }
    case 'web':
      return (
        <div className="flex flex-col gap-1 px-3 py-2">
          {body.hits.map((h, i) => (
            <div key={i} className="flex min-w-0 items-baseline gap-2 text-[12px]">
              {onOpenUrl !== undefined ? (
                <button
                  type="button"
                  onClick={() => onOpenUrl(h.url)}
                  title={h.url}
                  className="slip cursor-pointer truncate text-left text-s11 underline decoration-s6 underline-offset-[3px] hover:text-s12 hover:decoration-s8"
                >
                  {h.title}
                </button>
              ) : (
                <span className="truncate text-s11">{h.title}</span>
              )}
              <span className="min-w-0 flex-none truncate font-mono text-meta text-s6">
                {h.url.replace(/^https?:\/\//, '').split('/')[0]}
              </span>
            </div>
          ))}
        </div>
      );
    case 'checks': {
      const failedCount = body.checks.filter((c) => !c.ok).length;
      return (
        <div className="py-1.5">
          {body.checks.map((c, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-[3px] font-mono text-code">
              {c.ok ? (
                <span aria-label="passed" className="w-3 text-center text-ok/70">
                  ✓
                </span>
              ) : (
                <span aria-label="failed" className="w-3 text-center font-[550] text-crit">
                  ✕
                </span>
              )}
              <span className={c.ok ? 'text-s9' : 'text-s11'}>{c.name}</span>
              {c.ms !== undefined && (
                <span className="ml-auto text-meta text-s6">
                  {c.ms >= 1000 ? `${(c.ms / 1000).toFixed(1)}s` : `${c.ms}ms`}
                </span>
              )}
            </div>
          ))}
          <div className="mt-1 border-t border-s3 px-3 pt-1.5 pb-0.5 font-mono text-meta text-s7">
            {body.checks.length - failedCount} passed
            {failedCount > 0 && (
              <>
                {' · '}
                <span className="text-crit">{failedCount} failed</span>
              </>
            )}
          </div>
        </div>
      );
    }
  }
}

/** The clamp affordance: one quiet full-width row. `leading` sits it above a
 *  tail-clamped body (command output hides its HEAD, not its tail). */
function ClampRow({
  hidden,
  onExpand,
  leading = false,
}: {
  hidden: number;
  onExpand?: (() => void) | undefined;
  leading?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onExpand?.();
      }}
      className={cx(
        'slip flex w-full cursor-pointer items-center gap-1.5 px-3 py-1 text-left font-mono text-meta text-s7 hover:bg-s3/60 hover:text-s10',
        leading ? 'border-b border-s3' : 'border-t border-s3',
      )}
    >
      <span className="text-[9px]">{leading ? '⌃' : '⌄'}</span>
      {hidden} more {hidden === 1 ? 'line' : 'lines'}
    </button>
  );
}

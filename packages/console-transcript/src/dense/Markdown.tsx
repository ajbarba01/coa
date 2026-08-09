import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tooltip, cx } from '@coa/console-kit';
import { CodeBlock } from './CodeBlock.js';

export interface MarkdownProps {
  source: string;
  className?: string;
  /** Render in the muted foreground instead of the default — for secondary prose like the
   *  reasoning trace, which reads as a quiet aside, not primary answer text. */
  muted?: boolean | undefined;
}

// The assistant prose vocabulary — every markdown block on the sand scale (see
// apps/workbench-proto/src/chat/Prose.tsx, the design reference this re-skins onto).
//
// The law of the scale: hierarchy is carried by weight and space, never by color or size
// jumps. Body ink is s11; emphasis reaches s12; secondary voices (quotes) step down to s10.
// Links stay ink with a stepped-down underline — accent hues never decorate prose.
//
// `code` and `a` are re-tokened locally here (not via the shared `Code`/`Link` primitives):
// `Code` is also used by Transcript for tool output in its own distinct treatment, and
// retokening the shared primitive would leak this prose-specific look into that surface.
export function Markdown({ source, className, muted }: MarkdownProps): React.JSX.Element {
  return (
    <div
      className={cx(
        // `min-w-0 break-words` keeps a long unbreakable token (a URL, a hash) from
        // widening the row past its column — the root cause of the transcript's
        // horizontal overflow + sticky-header spill + scroll jitter.
        //
        // `flex flex-col gap-2.5` is the ONE inter-block spacing mechanism (matches
        // apps/workbench-proto/src/chat/Prose.tsx exactly) — blocks carry no vertical
        // margin of their own, so it's identical whether this instance renders one
        // block (the streaming/gapped path's per-block `<Markdown>`) or many (the
        // settled single-instance path). Heading `pt-*` then adds ON TOP of that
        // uniform gap, which is what keeps heading hierarchy intact in both paths.
        'flex min-w-0 flex-col gap-2.5 wrap-break-word text-body leading-[1.5]',
        muted ? 'text-s10' : 'text-s11',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // The destination arrives on hover through the kit's tooltip, not a native
          // `title` — that one is drawn by the OS outside the page, so it can never wear
          // the console's skin, delay or placement.
          a: ({ href, children }) => (
            <Tooltip label={href ?? ''} side="top">
              <a
                href={href ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="slip cursor-pointer text-s11 underline decoration-s6 underline-offset-[3px] hover:text-s12 hover:decoration-s8"
              >
                {children}
              </a>
            </Tooltip>
          ),
          // react-markdown wraps fenced code in its own <pre>; CodeBlock renders its
          // own <pre> too, so unwrap here to avoid nesting <pre> inside <pre>.
          pre: ({ children }) => <>{children}</>,
          code: ({ className: cls, children }) => {
            const lang = /language-(\w+)/.exec(cls ?? '')?.[1];
            const text = String(children).replace(/\n$/, '');
            // react-markdown passes a language class only for fenced blocks.
            return lang !== undefined || text.includes('\n') ? (
              <CodeBlock code={text} language={lang} />
            ) : (
              <code className="rounded-r1 bg-s3 px-1 py-px font-mono text-code text-s11">
                {text}
              </code>
            );
          },
          h1: ({ children }) => (
            <h1 className="pt-2.5 text-h1 leading-snug font-semibold text-s12">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="pt-2 text-h2 leading-snug font-semibold text-s12">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="pt-1.5 text-body leading-snug font-semibold text-s12">{children}</h3>
          ),
          p: ({ children }) => <p className="text-body leading-[1.55] text-s11">{children}</p>,
          ul: ({ children }) => (
            <ul className="flex flex-col gap-1 pl-5 text-body leading-[1.5] text-s11 list-disc marker:text-s7 [&_ul]:mt-1 [&_ul]:marker:text-s6 [&_ul_li]:list-[circle]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="flex flex-col gap-1 pl-5 text-body leading-[1.5] text-s11 list-decimal marker:font-mono marker:text-[11px] marker:text-s8">
              {children}
            </ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-s5 pl-3 text-s10">{children}</blockquote>
          ),
          hr: () => <hr className="my-2 h-px w-full border-0 bg-s3" />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="border-collapse text-sec">{children}</table>
            </div>
          ),
          tbody: ({ children }) => (
            <tbody className="[&>tr]:border-b [&>tr]:border-s3 [&>tr:last-child]:border-0">
              {children}
            </tbody>
          ),
          th: ({ children }) => (
            <th className="border-b border-s4 px-2.5 py-1.5 text-left font-semibold whitespace-nowrap text-s12 first:pl-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 align-top text-s11 first:pl-0">{children}</td>
          ),
          // remark-gfm renders task-list checkboxes as a plain disabled <input>; keep
          // the real input (role=checkbox, checked state) for a11y/testability but
          // theme it with token utilities instead of the raw browser control.
          input: ({ type, checked, disabled }) =>
            type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                readOnly
                className={cx(
                  'mr-1.5 inline-block size-3.5 shrink-0 appearance-none rounded-r1 border align-middle',
                  checked ? 'border-s8 bg-s8' : 'border-s5',
                )}
              />
            ) : null,
          li: ({ className: c, children }) => (
            <li
              className={cx('leading-normal', (c ?? '').includes('task-list-item') && 'list-none')}
            >
              {children}
            </li>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

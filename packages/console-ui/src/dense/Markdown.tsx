import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code } from '../data/Code.js';
import { Link } from '../actions/Link.js';
import { cx } from '../lib/cx.js';
import { CodeBlock } from './CodeBlock.js';

export interface MarkdownProps {
  source: string;
  className?: string;
  /** Render in the muted foreground instead of the default — for secondary prose like the
   *  reasoning trace, which reads as a quiet aside, not primary answer text. */
  muted?: boolean | undefined;
}

export function Markdown({ source, className, muted }: MarkdownProps): React.JSX.Element {
  return (
    <div
      className={cx(
        // `min-w-0 break-words` keeps a long unbreakable token (a URL, a hash) from
        // widening the row past its column — the root cause of the transcript's
        // horizontal overflow + sticky-header spill + scroll jitter.
        'min-w-0 wrap-break-word text-body leading-[1.5] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        muted ? 'text-muted' : 'text-fg',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Link href={href ?? '#'} external>
              {children}
            </Link>
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
              <Code>{text}</Code>
            );
          },
          h1: ({ children }) => <h1 className="mt-6 mb-4 text-heading font-semibold text-fg">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-6 mb-4 text-body font-semibold text-fg">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-4 mb-2 text-label font-semibold text-fg">{children}</h3>,
          p: ({ children }) => <p className="mb-4">{children}</p>,
          ul: ({ children }) => <ul className="mb-4 pl-8 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="mb-4 pl-8 list-decimal space-y-1">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="mb-4 border-l-4 border-hairline pl-4 text-muted">{children}</blockquote>
          ),
          hr: () => <hr className="my-6 border-border-default" />,
          table: ({ children }) => (
            <div className="mb-4 overflow-x-auto">
              <table className="w-full border-collapse text-label">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-hairline bg-subtle px-3 py-1.5 text-left font-medium text-fg">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-hairline px-3 py-1.5 align-top">{children}</td>,
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
                  'mr-1.5 inline-block size-3.5 shrink-0 appearance-none rounded-[3px] border align-middle',
                  checked ? 'border-accent bg-accent' : 'border-hairline',
                )}
              />
            ) : null,
          li: ({ className: c, children }) => (
            <li className={cx('leading-normal', (c ?? '').includes('task-list-item') && 'list-none')}>{children}</li>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

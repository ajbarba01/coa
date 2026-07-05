// packages/console-ui/src/dense/ToolDiffView.tsx
import type { DiffLine } from './toolDiff.js';
import { SyntaxText } from './syntaxTheme.js';
import { cx } from '../lib/cx.js';

export interface ToolDiffViewProps {
  lines: DiffLine[];
  language?: string | undefined;
}

/** Byte-faithful inline diff: each row is a presentational gutter marker span plus the
 *  verbatim line, syntax-highlighted, over an add/remove/context tint. The marker is a
 *  separate span (never fused into the highlighted text) so payload bytes stay exact. */
export function ToolDiffView({ lines, language }: ToolDiffViewProps): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <div className="w-full font-mono text-label leading-[1.55]">
        {lines.map((line, i) => (
          <DiffRow key={i} line={line} language={language} />
        ))}
      </div>
    </div>
  );
}

function DiffRow({ line, language }: { line: DiffLine; language?: string | undefined }): React.JSX.Element {
  const marker = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
  return (
    <div
      className={cx(
        'whitespace-pre px-2.5',
        line.kind === 'added' && 'bg-success-tint',
        line.kind === 'removed' && 'bg-danger-tint',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'select-none',
          line.kind === 'added' && 'text-success-text',
          line.kind === 'removed' && 'text-danger-text',
          line.kind === 'context' && 'text-faint',
        )}
      >
        {`${marker} `}
      </span>
      <SyntaxText code={line.text} language={language} />
    </div>
  );
}

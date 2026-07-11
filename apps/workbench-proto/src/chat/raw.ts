import type { Block, Frame } from './model.js';

/** Flatten prose blocks back to plain text (the raw projection shows what the
 *  loop emitted, not what the renderer made of it). */
function blockText(b: Block): string {
  switch (b.t) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'p':
      return b.inline.map((r) => ('text' in r ? r.text : '')).join('');
    case 'ul':
    case 'ol':
      return b.items
        .map((i) => i.inline.map((r) => ('text' in r ? r.text : '')).join(''))
        .join(' ');
    case 'quote':
      return b.blocks.map(blockText).join(' ');
    case 'table':
      return b.head.join(' | ');
    case 'hr':
      return '---';
    case 'code':
      return b.code.split('\n')[0] ?? '';
  }
}

const clip = (s: string, n = 72): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** MOCK of D85's raw projection: what the unfiltered loop stream would look
 *  like for the governed frames the mock produced. The real console renders
 *  actual `raw` frames byte-faithfully; this derivation exists only so the
 *  design lab can show the mask coming off. */
export function rawProjection(frames: Frame[]): string[] {
  const out: string[] = [];
  for (const f of frames) {
    switch (f.kind) {
      case 'user':
        out.push(`{"type":"user","message":${JSON.stringify(clip(f.text))}}`);
        break;
      case 'think':
        out.push(`{"type":"thinking_delta","text":${JSON.stringify(clip(f.text, 64))}}`);
        break;
      case 'text':
        for (const b of f.blocks.slice(0, 2))
          out.push(`{"type":"text_delta","text":${JSON.stringify(clip(blockText(b), 64))}}`);
        break;
      case 'tool':
        out.push(
          `{"type":"tool_use","name":${JSON.stringify(f.view.tool)},"input":${JSON.stringify(
            clip(f.view.target ?? '', 56),
          )}}`,
        );
        if (f.view.ok !== undefined)
          out.push(
            `{"type":"tool_result","is_error":${String(!f.view.ok)},"content":${JSON.stringify(
              clip(f.view.meta ?? '…', 48),
            )}}`,
          );
        break;
      case 'plan':
        out.push(
          `{"type":"tool_use","name":"TodoWrite","input":{"todos":[${f.items
            .map((i) => JSON.stringify(clip(i.text, 24)))
            .join(',')}]}}`,
        );
        break;
      case 'subagent':
        out.push(
          `{"type":"agent","event":${JSON.stringify(f.event)},"worktree":${JSON.stringify(
            f.childWorktree,
          )}}`,
        );
        break;
      case 'approval':
        out.push(
          `{"type":"permission_request","tool":${JSON.stringify(f.tool)},"input":${JSON.stringify(
            clip(f.summary, 48),
          )}}`,
        );
        if (f.resolved !== undefined)
          out.push(`{"type":"permission_result","behavior":${JSON.stringify(f.resolved)}}`);
        break;
      case 'deny':
        out.push(
          `{"type":"permission_result","behavior":"deny","message":${JSON.stringify(
            clip(f.reason, 64),
          )}}`,
        );
        break;
      case 'error':
        out.push(`{"type":"error","message":${JSON.stringify(clip(f.message, 64))}}`);
        break;
      case 'note':
        break; // console-local — the loop never saw it, so raw doesn't either
      case 'raw':
        out.push(f.text);
        break;
    }
  }
  return out;
}

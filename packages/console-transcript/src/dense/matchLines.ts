/** One parsed search-result line: a path, an optional 1-based line number, and the
 *  optional trailing match text (verbatim — bytes preserved for byte-faithful rendering). */
export interface MatchLine {
  path: string;
  line?: number;
  text?: string;
}

// `path:line[:text]`. The path is lazy so the FIRST `:<digits>` boundary wins the split
// (a bare `path` with no line fails the `\d+`, so a Windows `C:\…:5:x` skips the drive
// colon and matches at `:5:`). Text (everything after) is kept verbatim, colons and all.
const GREP_LINE = /^(.*?):(\d+)(?::([\s\S]*))?$/;

/** Parse one output line from a search tool into a clickable target, or undefined when it
 *  doesn't parse (render the verbatim line as plain text instead). Pure; never throws.
 *  - `Grep`: `path:line[:text]` → `{ path, line, text? }`.
 *  - `Glob`: a bare `path` → `{ path }`. */
export function parseMatchLine(tool: string, raw: string): MatchLine | undefined {
  if (tool === 'Glob') {
    const path = raw.trim();
    return path.length === 0 ? undefined : { path };
  }
  if (tool === 'Grep') {
    const m = GREP_LINE.exec(raw);
    if (m === null) return undefined;
    const path = m[1];
    const line = m[2];
    if (path === undefined || path.length === 0 || line === undefined) return undefined;
    const text = m[3];
    const out: MatchLine = { path, line: Number(line) };
    if (text !== undefined) out.text = text;
    return out;
  }
  return undefined;
}

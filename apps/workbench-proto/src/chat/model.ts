/** The conversation frame model — the prototype's mirror of the daemon's
 *  `TranscriptFrame` union (packages/console-ui/src/dense/Transcript.tsx).
 *  Every field here is either carried by that contract or derivable from it
 *  (the mock pre-digests what the real renderer parses out of tool
 *  input/output JSON at runtime). Design nothing that needs more. */

export type PlanStatus = 'pending' | 'in-progress' | 'done';

export type SubagentEvent = 'spawn-proposal' | 'spawn' | 'running' | 'idle' | 'done' | 'rollup';

export interface Rollup {
  tools?: number | undefined;
  tokens?: number | undefined;
  cost?: number | undefined;
  status?: string | undefined;
}

/** The digested view of one tool call — everything the real card derives from
 *  `tool` + `input` + `output` + `ok`. `ok` undefined = still running. */
export interface ToolView {
  /** SDK tool name, case-sensitive ('Read', 'Edit', 'Bash', 'run_checks', …). */
  tool: string;
  /** Display verb — derived from the tool name by the real registry. */
  verb: string;
  /** The mono target: a file path, a command, a query. */
  target?: string | undefined;
  /** Line for path reveal (path targets only). */
  line?: number | undefined;
  /** undefined = running · true = ok · false = failed. */
  ok?: boolean | undefined;
  /** Right-side meta ('+9 −3', '214 lines', '≈1.2k tok') — derived. */
  meta?: string | undefined;
  /** Whether the target links out (file reveal / browser). */
  link?: 'path' | 'url' | undefined;
  body?: ToolBody | undefined;
}

export type DiffLineKind = 'add' | 'del' | 'ctx';

export type ToolBody =
  | { t: 'diff'; lang: Lang; lines: { k: DiffLineKind; text: string }[] }
  | { t: 'code'; lang: Lang; text: string } // read/source preview
  | { t: 'out'; text: string } // command output tail (error marks applied)
  | { t: 'matches'; hits: { path: string; line?: number | undefined; text?: string | undefined }[] }
  | { t: 'web'; hits: { title: string; url: string }[] }
  | { t: 'checks'; checks: { name: string; ok: boolean; ms?: number | undefined }[] };

export type Frame =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; blocks: Block[]; streaming?: boolean; depth?: number }
  | {
      kind: 'think';
      id: string;
      text: string;
      streaming?: boolean;
      durationMs?: number;
      depth?: number;
    }
  | { kind: 'tool'; id: string; view: ToolView; depth?: number }
  | { kind: 'plan'; id: string; items: { text: string; status: PlanStatus }[]; depth?: number }
  | {
      kind: 'subagent';
      id: string;
      /** The child's worktree — its tail segment is the display name. */
      childWorktree: string;
      event: SubagentEvent;
      rollup?: Rollup;
      depth?: number;
    }
  | {
      kind: 'approval';
      id: string;
      tool: string;
      summary: string;
      diffStat?: string;
      resolved?: 'approved' | 'denied';
    }
  | { kind: 'deny'; id: string; denyKind: 'close-gate' | 'cost-cap'; reason: string }
  | { kind: 'error'; id: string; message: string; origin?: 'tool' | 'loop' | 'daemon' }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'raw'; id: string; text: string };

/* ------------------------------------------------------------------ */
/* Prose blocks — the mock of the real renderer's markdown block split. */
/* ------------------------------------------------------------------ */

export type Inline =
  | { k: 't'; text: string }
  | { k: 'b'; text: string }
  | { k: 'i'; text: string }
  | { k: 'c'; text: string }
  | { k: 'a'; text: string; href: string };

export interface ListItem {
  inline: Inline[];
  sub?: { t: 'ul' | 'ol'; items: ListItem[] } | undefined;
}

export type Lang = 'ts' | 'bash' | 'json' | 'text';

export type Block =
  | { t: 'h1' | 'h2' | 'h3'; inline: Inline[] }
  | { t: 'p'; inline: Inline[] }
  | { t: 'ul' | 'ol'; items: ListItem[] }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'hr' }
  | { t: 'code'; lang: Lang; name?: string | undefined; code: string };

/** Parse the inline-markdown subset the specimens use (`**b**`, `*i*`,
 *  `` `c` ``, `[t](href)`) into inline runs. Mock-only — the real renderer
 *  parses full markdown; this exists so specimen strings stay readable. */
export function md(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let at = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > at) out.push({ k: 't', text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ k: 'b', text: m[1] });
    else if (m[2] !== undefined) out.push({ k: 'i', text: m[2] });
    else if (m[3] !== undefined) out.push({ k: 'c', text: m[3] });
    else if (m[4] !== undefined && m[5] !== undefined) out.push({ k: 'a', text: m[4], href: m[5] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ k: 't', text: text.slice(at) });
  return out;
}

/** Shorthand for a paragraph block. */
export const p = (text: string): Block => ({ t: 'p', inline: md(text) });

/** Map a fence info string onto the lab's language union. */
function fenceLang(info: string): Lang {
  const l = info.trim().toLowerCase();
  if (l === 'ts' || l === 'tsx' || l === 'typescript' || l === 'js' || l === 'javascript')
    return 'ts';
  if (l === 'bash' || l === 'sh' || l === 'shell' || l === 'zsh') return 'bash';
  if (l === 'json') return 'json';
  return 'text';
}

/** Parse block-level markdown into the prose block model — the lab's mock of
 *  the real renderer's block split (headings, paragraphs, lists incl. one
 *  nesting level, quotes, tables, fences, hr). Not a spec-complete parser;
 *  exactly enough for the transcript's vocabulary, so the showcase can render
 *  real markdown source. */
export function parseMarkdown(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  const flushList = (t: 'ul' | 'ol', items: ListItem[], sub: ListItem[] | null): void => {
    if (sub !== null && sub.length > 0 && items.length > 0) {
      const last = items[items.length - 1];
      if (last !== undefined) last.sub = { t: 'ul', items: sub };
    }
    if (items.length > 0) out.push({ t, items });
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    // fenced code
    const fence = /^```(.*)$/.exec(line);
    if (fence !== null) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence
      out.push({ t: 'code', lang: fenceLang(fence[1] ?? ''), code: body.join('\n') });
      continue;
    }
    // heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h !== null) {
      const t = h[1]?.length === 1 ? 'h1' : h[1]?.length === 2 ? 'h2' : 'h3';
      out.push({ t, inline: md(h[2] ?? '') });
      i++;
      continue;
    }
    // hr
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    // quote — consecutive > lines parse recursively
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) {
        inner.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push({ t: 'quote', blocks: parseMarkdown(inner.join('\n')) });
      continue;
    }
    // table — a | row followed by a |---| separator
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (row: string): string[] =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? '')) {
        rows.push(cells(lines[i] ?? ''));
        i++;
      }
      out.push({ t: 'table', head, rows });
      continue;
    }
    // lists — one nesting level (2+ space indent nests under the last item)
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li !== null) {
      const ordered = /\d+\./.test(li[2] ?? '');
      const t = ordered ? 'ol' : 'ul';
      const items: ListItem[] = [];
      let sub: ListItem[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i] ?? '');
        if (m === null) break;
        const nested = (m[1] ?? '').length >= 2;
        if (nested) sub.push({ inline: md(m[3] ?? '') });
        else {
          if (sub.length > 0 && items.length > 0) {
            const last = items[items.length - 1];
            if (last !== undefined) last.sub = { t: 'ul', items: sub };
            sub = [];
          }
          items.push({ inline: md(m[3] ?? '') });
        }
        i++;
      }
      flushList(t, items, sub);
      continue;
    }
    // paragraph — collect until a blank or a structural line
    const para: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^(#{1,3}\s|```|\s*>|\s*\||\s*([-*]|\d+\.)\s|-{3,}\s*$)/.test(lines[i] ?? '')
    ) {
      para.push((lines[i] ?? '').trim());
      i++;
    }
    out.push(p(para.join(' ')));
  }
  return out;
}

/* ------------------------------------------------------- */
/* Code tokens — the mock of the real hljs token classes.   */
/* ------------------------------------------------------- */

export type TokenClass = 'key' | 'str' | 'num' | 'type' | 'fn' | 'punct' | 'comment' | 'plain';

export interface Token {
  cls: TokenClass;
  text: string;
}

const TS_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'import',
  'from',
  'export',
  'default',
  'async',
  'await',
  'new',
  'class',
  'extends',
  'interface',
  'type',
  'enum',
  'this',
  'typeof',
  'instanceof',
  'in',
  'of',
  'try',
  'catch',
  'finally',
  'throw',
  'switch',
  'case',
  'break',
  'continue',
  'void',
  'yield',
  'static',
  'readonly',
  'public',
  'private',
  'protected',
  'implements',
  'undefined',
  'null',
  'true',
  'false',
  'never',
  'unknown',
  'any',
  'string',
  'number',
  'boolean',
  'object',
  'symbol',
  'bigint',
  'as',
  'satisfies',
  'keyof',
  'is',
]);

const BASH_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'do',
  'done',
  'while',
  'case',
  'esac',
  'function',
  'return',
  'exit',
  'export',
  'local',
  'echo',
  'cd',
  'set',
]);

/** Crude single-line tokenizer for the design specimens. NOT a highlighter —
 *  the real console uses hljs; the token CLASSES here map 1:1 onto the
 *  `--color-syn-*` theme tokens, which is the part that ports. */
export function tokenize(line: string, lang: Lang): Token[] {
  if (lang === 'text') return [{ cls: 'plain', text: line }];
  const out: Token[] = [];
  const re =
    lang === 'bash'
      ? /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\$\{?\w+\}?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w-]*)|([^\sA-Za-z_]+)|(\s+)/g
      : /(\/\/.*$|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([^\sA-Za-z_$]+)|(\s+)/g;
  let m = re.exec(line);
  while (m !== null) {
    const [, comment, str, aOrNum, bOrWord, cOrPunct, dOrPunct, ws] = m;
    if (comment !== undefined) out.push({ cls: 'comment', text: comment });
    else if (str !== undefined) out.push({ cls: 'str', text: str });
    else if (lang === 'bash' && aOrNum !== undefined) out.push({ cls: 'type', text: aOrNum });
    else if (aOrNum !== undefined) out.push({ cls: 'num', text: aOrNum });
    else if (bOrWord !== undefined) {
      if (lang === 'bash') out.push({ cls: 'num', text: bOrWord });
      else {
        const next = line.slice(m.index + bOrWord.length);
        const kw = TS_KEYWORDS.has(bOrWord);
        out.push({
          cls: kw ? 'key' : /^[A-Z]/.test(bOrWord) ? 'type' : /^\s*\(/.test(next) ? 'fn' : 'plain',
          text: bOrWord,
        });
      }
    } else if (cOrPunct !== undefined) {
      if (lang === 'bash') {
        const kw = BASH_KEYWORDS.has(cOrPunct);
        const next = line.slice(m.index + cOrPunct.length);
        out.push({
          cls: kw ? 'key' : m.index === 0 && /^\s/.test(next) ? 'fn' : 'plain',
          text: cOrPunct,
        });
      } else out.push({ cls: 'punct', text: cOrPunct });
    } else if (dOrPunct !== undefined) out.push({ cls: 'punct', text: dOrPunct });
    else if (ws !== undefined) out.push({ cls: 'plain', text: ws });
    m = re.exec(line);
  }
  return out;
}

/** Split words for the per-word streaming reveal, whitespace preserved as its
 *  own tokens (mirrors the real splitWords). */
export function splitWords(text: string): { word: boolean; value: string }[] {
  const out: { word: boolean; value: string }[] = [];
  for (const part of text.split(/(\s+)/)) {
    if (part === '') continue;
    out.push({ word: !/^\s+$/.test(part), value: part });
  }
  return out;
}

/** Error-token marking for plain command output — mirrors the real
 *  `markErrors`: ranges matching error vocabulary render in the danger tint. */
export function errorSpans(line: string): { err: boolean; text: string }[] {
  const re = /\b(error|failed|failure|fatal|exception|cannot|denied)\b/gi;
  const out: { err: boolean; text: string }[] = [];
  let at = 0;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    if (m.index > at) out.push({ err: false, text: line.slice(at, m.index) });
    out.push({ err: true, text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ err: false, text: line.slice(at) });
  return out;
}

let n = 0;
/** Frame id source for mock/scripted content. */
export const fid = (): string => `f${n++}`;

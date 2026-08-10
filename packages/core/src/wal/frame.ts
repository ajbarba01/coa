import { changeEventSchema, SCHEMA_VERSION, type ChangeEvent } from '@coa/shared';

/**
 * The NDJSON frame codec + the torn-tail-tolerant, schema-version-guarding reader.
 * The WAL is one Zod-validated change-event per line. The kernel's reader
 * owns the frame-schema-migration chain: a *higher* unknown `schema_version`
 * makes the reader refuse and quarantine the segment (never a silent
 * skip/downgrade); a torn trailing line (a crash mid-append, no `\n`) is
 * discarded on read.
 */
export function serializeFrame(event: ChangeEvent): string {
  return JSON.stringify(event);
}

export interface QuarantineNotice {
  /** Zero-based index of the offending complete line. */
  line: number;
  schemaVersion: number;
}

export interface ReadResult {
  frames: ChangeEvent[];
  /** Present iff the reader hit a higher unknown `schema_version` and stopped there. */
  quarantine?: QuarantineNotice;
}

/**
 * Parse a WAL segment's text into frames. Only newline-terminated lines are
 * complete; a trailing line without its `\n` is treated as torn and dropped.
 * Stops at the first frame whose `schema_version` exceeds {@link SCHEMA_VERSION},
 * returning the frames read so far plus a {@link QuarantineNotice}. A
 * structurally invalid frame (a corrupt known-version line) throws — it is a bug,
 * not a recoverable tail.
 */
export function readFrames(content: string): ReadResult {
  const frames: ChangeEvent[] = [];
  const completeLines = toCompleteLines(content);

  for (let line = 0; line < completeLines.length; line++) {
    const raw: unknown = JSON.parse(completeLines[line] ?? '');
    const version = schemaVersionOf(raw);
    if (version !== undefined && version > SCHEMA_VERSION) {
      return { frames, quarantine: { line, schemaVersion: version } };
    }
    frames.push(changeEventSchema.parse(raw));
  }

  return { frames };
}

/** Newline-terminated lines only; a torn (un-terminated) trailing fragment is dropped. */
function toCompleteLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split('\n');
  // `split` leaves a final element after the last '\n': '' when terminated, the
  // torn fragment otherwise. Either way that trailing element is not a complete line.
  lines.pop();
  return lines;
}

function schemaVersionOf(raw: unknown): number | undefined {
  if (typeof raw === 'object' && raw !== null && 'schema_version' in raw) {
    const value = (raw as { schema_version: unknown }).schema_version;
    if (typeof value === 'number') return value;
  }
  return undefined;
}

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import type { ChangeEvent } from '@coa/shared';
import { readFrames, serializeFrame, type ReadResult } from './frame.js';

/**
 * The durable WAL (D94): ordered append + `fsync` at the batch boundary. The
 * file is opened in append mode so a reopen continues the existing log (the log
 * is the source of truth — every projection rebuilds from it). `append` performs
 * the write; `sync` performs the one `fsync` per coalesced batch the caller
 * controls. Reads go through the torn-tail-tolerant {@link readFrames}.
 */
export class Wal {
  private readonly fd: number;

  constructor(private readonly filePath: string) {
    this.fd = openSync(filePath, 'a');
  }

  /** Append one frame's NDJSON line. Durable only after a subsequent {@link sync}. */
  append(event: ChangeEvent): void {
    writeSync(this.fd, serializeFrame(event) + '\n');
  }

  /** Flush the OS buffer to disk — one call per coalesced batch (D94). */
  sync(): void {
    fsyncSync(this.fd);
  }

  /** Replay the full log, dropping any torn trailing line. */
  read(): ReadResult {
    if (!existsSync(this.filePath)) return { frames: [] };
    return readFrames(readFileSync(this.filePath, 'utf8'));
  }

  close(): void {
    closeSync(this.fd);
  }
}

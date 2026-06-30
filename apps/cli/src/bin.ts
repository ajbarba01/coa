#!/usr/bin/env node
import { runCli, startDaemon } from './cli.js';

/**
 * The `coa` executable. `coa serve` starts the daemon and keeps the process alive
 * serving the endpoint; every other verb is a one-shot client read that connects,
 * prints, and exits with the command's status. All logic lives in `cli.ts` (tested
 * over a real daemon); this shim only binds it to the process streams.
 */

const out = (line: string): void => void process.stdout.write(`${line}\n`);
const err = (line: string): void => void process.stderr.write(`${line}\n`);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'serve') {
    await startDaemon({ out, err });
    return; // the bound server keeps the event loop alive
  }
  process.exitCode = await runCli(argv, { out, err });
}

void main().catch((error: unknown) => {
  err(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

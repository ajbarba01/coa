import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assembleProducers,
  createGenerationRunner,
  loadGenerateFile,
  type GenerationIo,
  type Producer,
} from '@coa/core';

/**
 * The app-side L-GEN runner port — run a declared generator as a child process in
 * the worktree root (its stdout is the regenerated output), and read a target's
 * checked-in bytes. This is the minimal floor: the runner core supplies the fixed
 * GEN-8 environment, the command is the user's own committed generator, and we
 * shell out in `root`. A confined/sandboxed exec and temp-dir isolation are later.
 */
export function nodeGenerationIo(root: string): GenerationIo {
  return {
    exec: (command, env) => execSync(command, { cwd: root, env: { ...process.env, ...env } }),
    readFile: (path) => readFileSync(join(root, path)),
  };
}

/**
 * Assemble the generation producers from the worktree's committed
 * `.coa/generate.yaml`, so the SSOT-constraint producer fires on real declared
 * relations during a session. An absent registry yields no producers (the daemon
 * stays the inert floor). The io port is injectable for testing; it defaults to
 * the real child-process runner rooted at the worktree.
 */
export function buildGenerationProducers(
  root: string,
  io: GenerationIo = nodeGenerationIo(root),
): Producer[] {
  const entries = loadGenerateFile(join(root, '.coa', 'generate.yaml'));
  const runner = createGenerationRunner(entries, io);
  return assembleProducers(entries, runner);
}

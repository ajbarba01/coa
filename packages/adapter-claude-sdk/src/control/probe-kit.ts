import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

/** What the SDK handed the CLI process for one `query()` call. */
export interface SpawnCapture {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  /**
   * The flag's value, or undefined when the flag is absent. Handles both argv
   * spellings the SDK emits: a separate value token (`--allowedTools Read,Grep`)
   * and an inline one (`--setting-sources=`). An inline flag with an empty value
   * returns `''`, which is distinct from the `undefined` an absent flag returns —
   * `settingSources: []` is a real setting, not an omission, and conflating the two
   * would silently invert that probe.
   */
  flag(name: string): string | undefined;
  hasFlag(name: string): boolean;
  /** The flag's value, parsed as JSON. */
  json<T>(name: string): T | undefined;
}

const STUB = fileURLToPath(new URL('./stub-cli.mjs', import.meta.url));

function readCapture(path: string): SpawnCapture {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    argv: string[];
    env: Record<string, string | undefined>;
  };
  const inline = (name: string): string | undefined =>
    raw.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);

  const flag = (name: string): string | undefined => {
    const i = raw.argv.indexOf(name);
    if (i !== -1) return raw.argv[i + 1];
    return inline(name);
  };
  return {
    argv: raw.argv,
    env: raw.env,
    flag,
    hasFlag: (name) => raw.argv.includes(name) || inline(name) !== undefined,
    json: <T>(name: string): T | undefined => {
      const value = flag(name);
      return value === undefined || value === '' ? undefined : (JSON.parse(value) as T);
    },
  };
}

/**
 * Run one `query()` against the stub executable and return what the SDK spawned it
 * with. The query is expected to fail (the stub speaks no protocol); the capture
 * file is written first, so the failure is discarded and the capture returned.
 */
export async function captureSpawn(options: Options, prompt = 'probe'): Promise<SpawnCapture> {
  const dir = mkdtempSync(join(tmpdir(), 'coa-probe-'));
  const capturePath = join(dir, 'capture.json');

  const q = query({
    prompt,
    options: {
      ...options,
      executable: 'node',
      pathToClaudeCodeExecutable: STUB,
      env: { ...process.env, COA_PROBE_CAPTURE: capturePath },
    },
  });

  try {
    for await (const _message of q) {
      break;
    }
  } catch {
    // Expected: the stub exits without speaking stream-json.
  }

  if (!existsSync(capturePath)) {
    throw new Error(
      `captureSpawn: the SDK never spawned the stub (no capture at ${capturePath}). ` +
        'Check whether pathToClaudeCodeExecutable/executable are still honoured on this SDK version.',
    );
  }
  return readCapture(capturePath);
}

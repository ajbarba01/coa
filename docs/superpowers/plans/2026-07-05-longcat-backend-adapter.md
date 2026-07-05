# LongCat 2.0 Backend Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `LongCat-2.0` (Meituan's OpenAI-compatible agentic model) as a third coa backend — a thin `@coa/adapter-longcat` over the shared loop driver, selectable by `provider: 'longcat'`.

**Architecture:** Mirror `@coa/adapter-deepseek` (a pure-API `RuntimeAdapter` that renders the neutral config to a system prompt, resolves a key from the account pointer, builds the `complete()` primitive over HTTP, and drives `@coa/loop-driver`). Three real deltas from DeepSeek: the reasoning surface is a `thinking` on/off toggle (no effort ladder), the models endpoint lives at a different path prefix than chat, and the usage cache field is OpenAI-standard `prompt_tokens_details.cached_tokens`. Everything else in coa (tools, roles, context, the two SC-1 blocks, memory replay) is untouched.

**Tech Stack:** TypeScript (strict), pnpm workspaces, `tsdown`, Zod, Vitest, `fetch` (no provider SDK).

**Spec:** `docs/superpowers/specs/2026-07-05-longcat-backend-adapter-design.md`

## Global Constraints

- TypeScript `strict`, **no `any`**. Validate all external data at the edge with Zod (parse-and-drop unknown fields).
- **No provider SDK** — `fetch` only, injectable for tests.
- **Credential-blind** — store a pointer (env-var name or 0600 key-file path), never the key.
- **No `which-backend?` branch in `core`** — the adapter is constructed only in `apps/cli/src/adapter-factory.ts`.
- Chat base URL: `https://api.longcat.chat/openai/v1` · Models URL: `https://api.longcat.chat/v1/models` · Model id: `LongCat-2.0` (exact casing) · Default key var: `LONGCAT_API_KEY`.
- Default prices (USD/1M): in `0.75`, out `2.95`, cache `0.015`. Config override env: `COA_LONGCAT_PRICES`.
- Commit convention: **subject-only Conventional Commits**, no body, no trailer, no "Generated with" footer. Stage files **by name** (never `git add -A`).
- Single-file test run: `pnpm exec vitest run <path>`. Full gate: `pnpm check`.

---

### Task 1: Scaffold the package + wire it into the workspace + `credentials.ts`

Creates the package skeleton, registers it in every workspace manifest, and lands the first (simplest, byte-for-byte) module with its test. `credentials.ts` differs from DeepSeek only in the default key var.

**Files:**
- Create: `packages/adapter-longcat/package.json`
- Create: `packages/adapter-longcat/tsconfig.json`
- Create: `packages/adapter-longcat/tsdown.config.ts`
- Create: `packages/adapter-longcat/src/index.ts` (temporary single export; completed in Task 5)
- Create: `packages/adapter-longcat/src/credentials.ts`
- Test: `packages/adapter-longcat/src/credentials.test.ts`
- Modify: `tsconfig.json` (root solution references)
- Modify: `vitest.config.ts` (workspace alias)
- Modify: `apps/cli/package.json` (dependency)
- Modify: `apps/cli/tsconfig.json` (references)

**Interfaces:**
- Produces: `resolveApiKey(locator: Locator | undefined, env?: Record<string,string|undefined>, readKeyFile?: ReadKeyFile): string | undefined`; `DEFAULT_API_KEY_VAR = 'LONGCAT_API_KEY'`; `type ReadKeyFile = (path: string) => string | undefined`.

- [ ] **Step 1: Create `packages/adapter-longcat/package.json`**

```json
{
  "name": "@coa/adapter-longcat",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsdown",
    "typecheck": "tsc -b"
  },
  "dependencies": {
    "@coa/loop-driver": "workspace:*",
    "@coa/shared": "workspace:*",
    "@coa/spi": "workspace:*",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^26.0.1"
  }
}
```

- [ ] **Step 2: Create `packages/adapter-longcat/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo",
    "types": ["node"]
  },
  "references": [{ "path": "../shared" }, { "path": "../spi" }, { "path": "../loop-driver" }],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/adapter-longcat/tsdown.config.ts`**

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  unbundle: true,
  fixedExtension: false,
});
```

- [ ] **Step 4: Create a temporary `packages/adapter-longcat/src/index.ts`**

(Completed in Task 5; a single export keeps the entry compilable now.)

```ts
export { resolveApiKey, DEFAULT_API_KEY_VAR, type ReadKeyFile } from './credentials.js';
```

- [ ] **Step 5: Register the package in the four workspace manifests**

In root `tsconfig.json`, add to the `references` array (after the `adapter-deepseek` line):

```json
    { "path": "packages/adapter-longcat" },
```

In `vitest.config.ts`, add to the `workspaceAlias` object (after the `@coa/adapter-deepseek` entry):

```ts
  '@coa/adapter-longcat': fileURLToPath(
    new URL('./packages/adapter-longcat/src/index.ts', import.meta.url),
  ),
```

In `apps/cli/package.json`, add to `dependencies` (keep alphabetical):

```json
    "@coa/adapter-longcat": "workspace:*",
```

In `apps/cli/tsconfig.json`, add to `references` (after the `adapter-deepseek` line):

```json
    { "path": "../../packages/adapter-longcat" },
```

- [ ] **Step 6: Install so pnpm links the new workspace package**

Run: `pnpm install`
Expected: completes; `apps/cli` now resolves `@coa/adapter-longcat`.

- [ ] **Step 7: Write the failing test `packages/adapter-longcat/src/credentials.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { resolveApiKey, DEFAULT_API_KEY_VAR, type ReadKeyFile } from './credentials.js';

describe('resolveApiKey', () => {
  it('reads the key from the env var an env-var locator points at', () => {
    expect(resolveApiKey({ type: 'env-var', name: 'MY_KEY' }, { MY_KEY: 'sk-123' })).toBe('sk-123');
  });

  it('reads the key from the file a key-file locator points at (injected reader)', () => {
    const read: ReadKeyFile = (path) => (path === '/keys/lc' ? 'sk-file' : undefined);
    expect(resolveApiKey({ type: 'key-file', path: '/keys/lc' }, {}, read)).toBe('sk-file');
  });

  it('is undefined for a missing or empty key file', () => {
    expect(resolveApiKey({ type: 'key-file', path: '/nope' }, {}, () => undefined)).toBeUndefined();
    expect(resolveApiKey({ type: 'key-file', path: '/empty' }, {}, () => '')).toBeUndefined();
  });

  it('falls back to LONGCAT_API_KEY for any other/absent locator', () => {
    expect(DEFAULT_API_KEY_VAR).toBe('LONGCAT_API_KEY');
    expect(resolveApiKey(undefined, { [DEFAULT_API_KEY_VAR]: 'sk-default' })).toBe('sk-default');
    expect(resolveApiKey({ type: 'ambient' }, { [DEFAULT_API_KEY_VAR]: 'sk-default' })).toBe(
      'sk-default',
    );
  });

  it('is undefined when the pointed-at var is missing or empty', () => {
    expect(resolveApiKey({ type: 'env-var', name: 'MISSING' }, {})).toBeUndefined();
    expect(resolveApiKey({ type: 'env-var', name: 'EMPTY' }, { EMPTY: '' })).toBeUndefined();
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/adapter-longcat/src/credentials.test.ts`
Expected: FAIL — cannot resolve `./credentials.js` (module not written yet).

- [ ] **Step 9: Write `packages/adapter-longcat/src/credentials.ts`**

```ts
import { readFileSync } from 'node:fs';
import type { Locator } from '@coa/shared';

/** The env var a LongCat account with no explicit pointer falls back to. */
export const DEFAULT_API_KEY_VAR = 'LONGCAT_API_KEY';

/** Read a key file's contents (trimmed); a missing/unreadable file resolves to undefined. */
export type ReadKeyFile = (path: string) => string | undefined;

const defaultReadKeyFile: ReadKeyFile = (path) => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return undefined;
  }
};

/**
 * Resolve the LongCat API key from the account's locator — a POINTER, never a
 * secret stored in `accounts.yaml` (credential-blind invariant): an `env-var`
 * locator names the environment variable that holds the key; a `key-file` locator
 * names a coa-written 0600 file to read it from; any other/absent locator falls
 * back to the {@link DEFAULT_API_KEY_VAR} env var. `readKeyFile` is injectable for tests.
 */
export function resolveApiKey(
  locator: Locator | undefined,
  env: Record<string, string | undefined> = process.env,
  readKeyFile: ReadKeyFile = defaultReadKeyFile,
): string | undefined {
  if (locator?.type === 'key-file') return nonEmpty(readKeyFile(locator.path));
  const name = locator?.type === 'env-var' ? locator.name : DEFAULT_API_KEY_VAR;
  return nonEmpty(env[name]);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/adapter-longcat/src/credentials.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 11: Commit**

```bash
git add packages/adapter-longcat/package.json packages/adapter-longcat/tsconfig.json packages/adapter-longcat/tsdown.config.ts packages/adapter-longcat/src/index.ts packages/adapter-longcat/src/credentials.ts packages/adapter-longcat/src/credentials.test.ts tsconfig.json vitest.config.ts apps/cli/package.json apps/cli/tsconfig.json pnpm-lock.yaml
git commit -m "feat: scaffold LongCat backend adapter package with credential resolution"
```

---

### Task 2: `wire.ts` (edge schemas) + `pricing.ts` (cost accounting)

The OpenAI-compatible wire schemas, with the LongCat-specific usage block, plus the price table. `pricing.ts` reads `wire.ts`'s `WireUsage`.

**Files:**
- Create: `packages/adapter-longcat/src/wire.ts`
- Create: `packages/adapter-longcat/src/pricing.ts`
- Test: `packages/adapter-longcat/src/pricing.test.ts`

**Interfaces:**
- Produces (`wire.ts`): `chatCompletionResponseSchema`, `type ChatCompletionResponse`, `wireUsageSchema`, `type WireUsage` (`{ prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens: number } }`), `modelsResponseSchema`.
- Produces (`pricing.ts`): `type ModelPrice`, `type PriceTable`, `PRICES_ENV_VAR = 'COA_LONGCAT_PRICES'`, `DEFAULT_PRICES: PriceTable`, `loadPriceTable(env?): PriceTable`, `toRuntimeUsage(usage: WireUsage | undefined, model: string, table: PriceTable): RuntimeUsage`.

- [ ] **Step 1: Create `packages/adapter-longcat/src/wire.ts`**

```ts
import { z } from 'zod';

/**
 * The LongCat chat-completions wire types (OpenAI-compatible). coa validates the
 * response at the edge (Zod-parse-before-touch); unknown fields are dropped, so a
 * LongCat API change that only adds fields never breaks the mapping. Request shapes
 * are plain builders (no validation needed — coa authors them).
 */

/** A tool call the model emitted (OpenAI function-call shape; `arguments` is a JSON string). */
export const wireToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function').optional(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
export type WireToolCall = z.infer<typeof wireToolCallSchema>;

export const wireMessageSchema = z.object({
  // `role` is echoed by the API but coa consumes only content/tool_calls, so it is optional.
  role: z.string().optional(),
  content: z.string().nullable().optional(),
  // LongCat surfaces thinking as `reasoning_content`; coa consumes `content` only (dropped).
  tool_calls: z.array(wireToolCallSchema).optional(),
});

export const wireChoiceSchema = z.object({
  message: wireMessageSchema,
  finish_reason: z.string().nullable().optional(),
});

/**
 * LongCat's usage block. Cache-hit tokens follow the OpenAI-standard nested shape
 * `prompt_tokens_details.cached_tokens` (not DeepSeek's flat `prompt_cache_hit_tokens`).
 * The exact field is confirmed by the Task 9 live smoke; a wrong guess drops to
 * zero-cost here (parse-and-drop), never a crash.
 */
export const wireUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  prompt_tokens_details: z.object({ cached_tokens: z.number() }).optional(),
});
export type WireUsage = z.infer<typeof wireUsageSchema>;

export const chatCompletionResponseSchema = z.object({
  choices: z.array(wireChoiceSchema).min(1),
  usage: wireUsageSchema.optional(),
});
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;

/** The `/models` list response (OpenAI-compatible: `{ data: [{ id }] }`). */
export const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});
```

- [ ] **Step 2: Write the failing test `packages/adapter-longcat/src/pricing.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadPriceTable, toRuntimeUsage, PRICES_ENV_VAR, DEFAULT_PRICES } from './pricing.js';
import type { WireUsage } from './wire.js';

describe('loadPriceTable', () => {
  it('ships the published LongCat-2.0 default rates when unset', () => {
    expect(loadPriceTable({})).toEqual(DEFAULT_PRICES);
    expect(DEFAULT_PRICES['LongCat-2.0']).toEqual({
      inPerMillion: 0.75,
      outPerMillion: 2.95,
      cacheInPerMillion: 0.015,
    });
  });

  it('merges the config-overridable table over the defaults', () => {
    const table = loadPriceTable({
      [PRICES_ENV_VAR]: '{"LongCat-2.0":{"inPerMillion":0.3,"outPerMillion":1.2}}',
    });
    expect(table['LongCat-2.0']).toEqual({ inPerMillion: 0.3, outPerMillion: 1.2 });
  });

  it('falls back to the defaults for a malformed override', () => {
    expect(loadPriceTable({ [PRICES_ENV_VAR]: 'not json' })).toEqual(DEFAULT_PRICES);
    expect(loadPriceTable({ [PRICES_ENV_VAR]: '{"m":{"inPerMillion":-1}}' })).toEqual(DEFAULT_PRICES);
  });
});

describe('toRuntimeUsage', () => {
  const usage: WireUsage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };

  it('passes token counts through and prices a table entry', () => {
    const result = toRuntimeUsage(usage, 'm', { m: { inPerMillion: 1, outPerMillion: 2 } });
    expect(result).toEqual({ tokensIn: 1_000_000, tokensOut: 1_000_000, costUsd: 3 });
  });

  it('costs zero for a model absent from the table (the zero floor)', () => {
    expect(toRuntimeUsage(usage, 'unknown', {}).costUsd).toBe(0);
  });

  it('bills cached input tokens at the cache rate and reports them', () => {
    const cached: WireUsage = {
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
      prompt_tokens_details: { cached_tokens: 400_000 },
    };
    const result = toRuntimeUsage(cached, 'm', {
      m: { inPerMillion: 1, outPerMillion: 2, cacheInPerMillion: 0.5 },
    });
    // 600k fresh @1 + 400k cache @0.5 = 0.6 + 0.2
    expect(result.costUsd).toBeCloseTo(0.8, 10);
    expect(result.cacheReadTokens).toBe(400_000);
  });

  it('is all-zero for an absent usage block', () => {
    expect(toRuntimeUsage(undefined, 'm', {})).toEqual({ tokensIn: 0, tokensOut: 0, costUsd: 0 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/adapter-longcat/src/pricing.test.ts`
Expected: FAIL — cannot resolve `./pricing.js`.

- [ ] **Step 4: Write `packages/adapter-longcat/src/pricing.ts`**

```ts
import { z } from 'zod';
import type { RuntimeUsage } from '@coa/spi';
import type { WireUsage } from './wire.js';

/**
 * Cost accounting for a raw API. LongCat returns token usage but no dollar cost, so
 * coa computes it from a price table. LongCat's rates are published, so we ship real
 * defaults for `LongCat-2.0`, still config-overridable via `COA_LONGCAT_PRICES` (JSON,
 * per-million-token). A model with no entry costs 0 (the zero floor). Cache-hit input
 * tokens bill at the cache rate when one is configured.
 */

/** Per-model rates in USD per million tokens. */
export const modelPriceSchema = z.object({
  inPerMillion: z.number().nonnegative(),
  outPerMillion: z.number().nonnegative(),
  cacheInPerMillion: z.number().nonnegative().optional(),
});
export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const priceTableSchema = z.record(z.string(), modelPriceSchema);
export type PriceTable = z.infer<typeof priceTableSchema>;

export const PRICES_ENV_VAR = 'COA_LONGCAT_PRICES';

/** The published LongCat-2.0 rates coa ships by default; overridable per model via {@link PRICES_ENV_VAR}. */
export const DEFAULT_PRICES: PriceTable = {
  'LongCat-2.0': { inPerMillion: 0.75, outPerMillion: 2.95, cacheInPerMillion: 0.015 },
};

/** Load the price table: the shipped defaults, with the config env var overriding per model. */
export function loadPriceTable(env: Record<string, string | undefined> = process.env): PriceTable {
  const raw = env[PRICES_ENV_VAR];
  if (raw === undefined || raw === '') return { ...DEFAULT_PRICES };
  try {
    return { ...DEFAULT_PRICES, ...priceTableSchema.parse(JSON.parse(raw)) };
  } catch {
    return { ...DEFAULT_PRICES };
  }
}

/**
 * Compute the settled usage for one completion: pass the wire token counts through
 * to neutral {@link RuntimeUsage} and price them. A model absent from the table costs
 * 0. Cached tokens (`prompt_tokens_details.cached_tokens`) use `cacheInPerMillion` when
 * set, otherwise the normal input rate; the rest of the input bills at the input rate.
 */
export function toRuntimeUsage(
  usage: WireUsage | undefined,
  model: string,
  table: PriceTable,
): RuntimeUsage {
  if (usage === undefined) return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const tokensIn = usage.prompt_tokens;
  const tokensOut = usage.completion_tokens;
  const cacheHit = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const price = table[model];
  const costUsd = price === undefined ? 0 : billed(price, tokensIn, tokensOut, cacheHit);
  return {
    tokensIn,
    tokensOut,
    costUsd,
    ...(usage.prompt_tokens_details !== undefined ? { cacheReadTokens: cacheHit } : {}),
  };
}

function billed(price: ModelPrice, tokensIn: number, tokensOut: number, cacheHit: number): number {
  const cacheRate = price.cacheInPerMillion ?? price.inPerMillion;
  const freshIn = Math.max(tokensIn - cacheHit, 0);
  const perMillion = (tokens: number, rate: number): number => (tokens / 1_000_000) * rate;
  return (
    perMillion(freshIn, price.inPerMillion) +
    perMillion(cacheHit, cacheRate) +
    perMillion(tokensOut, price.outPerMillion)
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/adapter-longcat/src/pricing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-longcat/src/wire.ts packages/adapter-longcat/src/pricing.ts packages/adapter-longcat/src/pricing.test.ts
git commit -m "feat: add LongCat wire schemas and cost accounting"
```

---

### Task 3: `complete.ts` (the `complete()` primitive)

Builds the loop driver's `CompleteFn` over LongCat's chat/completions endpoint. Reasoning maps to `thinking` on/off (no `reasoning_effort`).

**Files:**
- Create: `packages/adapter-longcat/src/complete.ts`
- Test: `packages/adapter-longcat/src/complete.test.ts`

**Interfaces:**
- Consumes: `chatCompletionResponseSchema` (wire), `toRuntimeUsage`, `type PriceTable` (pricing); `CompleteFn`, `DriverMessage`, `ToolDef` (`@coa/loop-driver`).
- Produces: `DEFAULT_BASE_URL = 'https://api.longcat.chat/openai/v1'`, `DEFAULT_MODEL = 'LongCat-2.0'`, `type LongCatReasoning = { kind: 'enabled' } | { kind: 'disabled' }`, `type FetchLike`, `interface LongCatCompleteConfig`, `makeLongCatComplete(config: LongCatCompleteConfig): CompleteFn`.

- [ ] **Step 1: Write the failing test `packages/adapter-longcat/src/complete.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DriverMessage, ToolDef } from '@coa/loop-driver';
import { makeLongCatComplete, type FetchLike } from './complete.js';

interface Captured {
  url?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** A fake transport that captures the request and returns a canned JSON response. */
function fakeFetch(response: unknown, captured: Captured, ok = true, status = 200): FetchLike {
  return async (url, init) => {
    captured.url = url;
    captured.headers = init.headers;
    captured.body = init.body !== undefined ? JSON.parse(init.body) : undefined;
    return {
      ok,
      status,
      text: async () => 'error body',
      json: async () => response,
    };
  };
}

const textResponse = {
  choices: [{ message: { content: 'hello' } }],
  usage: { prompt_tokens: 10, completion_tokens: 4 },
};

describe('makeLongCatComplete', () => {
  it('builds the request: model, mapped messages, JSON-schema tools, and auth header', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'LongCat-2.0',
      fetchImpl: fakeFetch(textResponse, captured),
    });
    const messages: DriverMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ];
    const tools: ToolDef[] = [
      { name: 'get_symbol', description: 'd', parameters: { name: z.string() } },
    ];

    await complete(messages, tools);

    expect(captured.url).toBe('https://api.longcat.chat/openai/v1/chat/completions');
    expect(captured.headers?.['authorization']).toBe('Bearer sk-1');
    expect(captured.body?.['model']).toBe('LongCat-2.0');
    expect(captured.body?.['messages']).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ]);
    const wireTool = (captured.body?.['tools'] as Array<{ function: { parameters: unknown } }>)[0]!;
    expect(wireTool.function.parameters).toMatchObject({ type: 'object' });
  });

  it('maps the response to text, parsed tool calls, and priced usage', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      prices: { m: { inPerMillion: 1_000_000, outPerMillion: 0 } },
      fetchImpl: fakeFetch(
        {
          choices: [
            {
              message: {
                content: 'looking',
                tool_calls: [
                  {
                    id: 't1',
                    type: 'function',
                    function: { name: 'get_symbol', arguments: '{"name":"pay"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        },
        captured,
      ),
    });

    const result = await complete([{ role: 'user', content: 'go' }], []);

    expect(result.text).toBe('looking');
    expect(result.toolCalls).toEqual([{ id: 't1', name: 'get_symbol', arguments: { name: 'pay' } }]);
    expect(result.usage).toMatchObject({ tokensIn: 2, tokensOut: 1, costUsd: 2 });
  });

  it('enables thinking when reasoning is enabled, and maps tool + assistant messages', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      reasoning: { kind: 'enabled' },
      fetchImpl: fakeFetch(textResponse, captured),
    });
    const messages: DriverMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'x', arguments: { a: 1 } }] },
      { role: 'tool', toolCallId: 't1', content: 'ok' },
    ];

    await complete(messages, []);

    expect(captured.body?.['thinking']).toEqual({ type: 'enabled' });
    const wireMessages = captured.body?.['messages'] as Array<Record<string, unknown>>;
    expect(wireMessages[0]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }],
    });
    expect(wireMessages[1]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'ok' });
  });

  it('disables thinking for the disabled reasoning kind', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      reasoning: { kind: 'disabled' },
      fetchImpl: fakeFetch(textResponse, captured),
    });

    await complete([{ role: 'user', content: 'go' }], []);

    expect(captured.body?.['thinking']).toEqual({ type: 'disabled' });
  });

  it('sends no thinking field when reasoning is absent', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      fetchImpl: fakeFetch(textResponse, captured),
    });

    await complete([{ role: 'user', content: 'go' }], []);

    expect(captured.body?.['thinking']).toBeUndefined();
  });

  it('throws with the status on a non-ok response', async () => {
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      fetchImpl: fakeFetch({}, {}, false, 429),
    });
    await expect(complete([{ role: 'user', content: 'go' }], [])).rejects.toThrow('429');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/adapter-longcat/src/complete.test.ts`
Expected: FAIL — cannot resolve `./complete.js`.

- [ ] **Step 3: Write `packages/adapter-longcat/src/complete.ts`**

```ts
import { z, type ZodRawShape } from 'zod';
import type { CompleteFn, DriverMessage, ToolDef } from '@coa/loop-driver';
import { chatCompletionResponseSchema } from './wire.js';
import { toRuntimeUsage, type PriceTable } from './pricing.js';

/** LongCat's default OpenAI-compatible API host + model. */
export const DEFAULT_BASE_URL = 'https://api.longcat.chat/openai/v1';
export const DEFAULT_MODEL = 'LongCat-2.0';

/**
 * LongCat's reasoning surface is a thinking on/off toggle (`thinking: {type}`), not a
 * graded `reasoning_effort`. coa maps `off` -> disabled, any effort -> enabled, and
 * sends nothing when reasoning is absent (the model default).
 */
export type LongCatReasoning = { kind: 'enabled' } | { kind: 'disabled' };

/** A minimal `fetch` surface (injectable so `complete()` is unit-testable with no network). */
export type FetchLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface LongCatCompleteConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  reasoning?: LongCatReasoning;
  /** The config-overridable price table; absent ⇒ the shipped LongCat-2.0 defaults are used upstream. */
  prices?: PriceTable;
  /** Injectable transport (defaults to global `fetch`). */
  fetchImpl?: FetchLike;
}

/** The request fields for a reasoning selection: thinking enabled/disabled, or nothing. */
function reasoningBody(reasoning: LongCatReasoning | undefined): Record<string, unknown> {
  if (reasoning === undefined) return {};
  return { thinking: { type: reasoning.kind === 'disabled' ? 'disabled' : 'enabled' } };
}

/** Build the {@link CompleteFn} primitive for the loop driver over LongCat's HTTP API. */
export function makeLongCatComplete(config: LongCatCompleteConfig): CompleteFn {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const prices = config.prices ?? {};

  return async (messages, tools) => {
    const body = {
      model: config.model,
      messages: messages.map(toWireMessage),
      ...(tools.length > 0 ? { tools: tools.map(toWireTool) } : {}),
      ...reasoningBody(config.reasoning),
    };
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`longcat chat/completions failed: ${res.status} ${await res.text()}`);
    }
    const parsed = chatCompletionResponseSchema.parse(await res.json());
    const choice = parsed.choices[0]!;
    return {
      text: choice.message.content ?? '',
      toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      })),
      usage: toRuntimeUsage(parsed.usage, config.model, prices),
    };
  };
}

/** Map a neutral driver message to the OpenAI-compatible wire message. */
function toWireMessage(message: DriverMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  }
  if (message.role === 'assistant' && message.toolCalls !== undefined) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

/** Map a governed tool to the OpenAI-compatible function tool (Zod raw shape → JSON schema). */
function toWireTool(tool: ToolDef): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool.parameters),
    },
  };
}

/** Convert the M6 Zod raw shape the driver carries to JSON schema; degrade to a permissive object. */
function toJsonSchema(parameters: unknown): unknown {
  try {
    return z.toJSONSchema(z.object(parameters as ZodRawShape));
  } catch {
    return { type: 'object', additionalProperties: true };
  }
}

/** Parse a tool call's JSON-string arguments; a malformed string degrades to empty args. */
function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/adapter-longcat/src/complete.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-longcat/src/complete.ts packages/adapter-longcat/src/complete.test.ts
git commit -m "feat: add LongCat complete() primitive with thinking toggle"
```

---

### Task 4: `models.ts` (model discovery)

Discovers the account's models from LongCat's `/v1/models` endpoint. The key structural delta from DeepSeek: the models URL is independent of the chat base URL (different path prefix). `LongCat-2.0` has a thinking toggle, not an effort ladder, so its descriptor carries no `supportsEffort`.

**Files:**
- Create: `packages/adapter-longcat/src/models.ts`
- Test: `packages/adapter-longcat/src/models.test.ts`

**Interfaces:**
- Consumes: `modelsResponseSchema` (wire); `type FetchLike` (complete); `ClaudeEffort`, `ModelDescriptor` (`@coa/shared`).
- Produces: `DEFAULT_MODELS_URL = 'https://api.longcat.chat/v1/models'`, `EFFORT_ENV_VAR = 'COA_LONGCAT_EFFORT'`, `DEFAULT_EFFORT_CAPS: EffortCaps = {}`, `type EffortCaps`, `loadEffortCaps(env?): EffortCaps`, `toModelDescriptor(id: string, caps: EffortCaps): ModelDescriptor`, `interface FetchModelsConfig`, `fetchLongCatModels(config: FetchModelsConfig): Promise<ModelDescriptor[]>`.

- [ ] **Step 1: Write the failing test `packages/adapter-longcat/src/models.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  fetchLongCatModels,
  loadEffortCaps,
  toModelDescriptor,
  DEFAULT_MODELS_URL,
  EFFORT_ENV_VAR,
} from './models.js';
import type { FetchLike } from './complete.js';

function okModels(ids: string[], captured?: { url?: string }): FetchLike {
  return async (url) => {
    if (captured !== undefined) captured.url = url;
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ data: ids.map((id) => ({ id })) }),
    };
  };
}

describe('loadEffortCaps', () => {
  it('is empty by default (LongCat-2.0 exposes a thinking toggle, not an effort ladder)', () => {
    expect(loadEffortCaps({})).toEqual({});
    expect(loadEffortCaps({ [EFFORT_ENV_VAR]: 'nope' })).toEqual({});
  });

  it('accepts a config override for a future model', () => {
    expect(loadEffortCaps({ [EFFORT_ENV_VAR]: '{"LongCat-3.0":["high","max"]}' })).toEqual({
      'LongCat-3.0': ['high', 'max'],
    });
  });
});

describe('toModelDescriptor', () => {
  it('has no effort control for LongCat-2.0 (unlisted), and attaches a ladder when configured', () => {
    expect(toModelDescriptor('LongCat-2.0', {})).toEqual({ id: 'LongCat-2.0' });
    expect(toModelDescriptor('LongCat-3.0', { 'LongCat-3.0': ['high'] })).toEqual({
      id: 'LongCat-3.0',
      supportsEffort: true,
      supportedEffortLevels: ['high'],
    });
  });
});

describe('fetchLongCatModels', () => {
  it('lists the account models from the dedicated /v1/models URL', async () => {
    const captured: { url?: string } = {};
    const models = await fetchLongCatModels({
      apiKey: 'sk-1',
      fetchImpl: okModels(['LongCat-2.0'], captured),
    });
    expect(captured.url).toBe(DEFAULT_MODELS_URL);
    expect(models).toEqual([{ id: 'LongCat-2.0' }]);
  });

  it('throws (rather than silently returning []) when the endpoint is not ok', async () => {
    await expect(
      fetchLongCatModels({
        apiKey: 'sk-1',
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => '',
          json: async () => ({}),
        }),
      }),
    ).rejects.toThrow(/401/);
  });

  it('returns an empty list for a genuinely-empty but successful response', async () => {
    const models = await fetchLongCatModels({ apiKey: 'sk-1', fetchImpl: okModels([]) });
    expect(models).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/adapter-longcat/src/models.test.ts`
Expected: FAIL — cannot resolve `./models.js`.

- [ ] **Step 3: Write `packages/adapter-longcat/src/models.ts`**

```ts
import { z } from 'zod';
import type { ClaudeEffort, ModelDescriptor } from '@coa/shared';
import { modelsResponseSchema } from './wire.js';
import { type FetchLike } from './complete.js';

/**
 * Backend model discovery for LongCat. The model list is fetched live from the
 * OpenAI-compatible list endpoint, so the account's real models appear without a code
 * change. Note LongCat's list endpoint lives at `/v1/models` — a DIFFERENT path prefix
 * than chat (`/openai/v1/...`) — so the models URL is resolved independently, not from
 * the chat base URL. `LongCat-2.0` exposes a thinking toggle, not a graded effort ladder,
 * so per-model effort levels come from a config-overridable map (`COA_LONGCAT_EFFORT`,
 * JSON) that ships empty; a model absent from it exposes no effort control.
 */

export const DEFAULT_MODELS_URL = 'https://api.longcat.chat/v1/models';
export const EFFORT_ENV_VAR = 'COA_LONGCAT_EFFORT';

/** `{ "LongCat-3.0": ["high","max"] }` — per-model supported effort levels (coa's ladder). */
export const effortCapsSchema = z.record(
  z.string(),
  z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])),
);
export type EffortCaps = z.infer<typeof effortCapsSchema>;

/** LongCat-2.0 has no effort ladder (thinking on/off only), so the shipped defaults are empty. */
export const DEFAULT_EFFORT_CAPS: EffortCaps = {};

/** Load the per-model effort ladders: the empty defaults, with the config env var overriding per model. */
export function loadEffortCaps(env: Record<string, string | undefined> = process.env): EffortCaps {
  const raw = env[EFFORT_ENV_VAR];
  if (raw === undefined || raw === '') return { ...DEFAULT_EFFORT_CAPS };
  try {
    return { ...DEFAULT_EFFORT_CAPS, ...effortCapsSchema.parse(JSON.parse(raw)) };
  } catch {
    return { ...DEFAULT_EFFORT_CAPS };
  }
}

/** Map a LongCat model id + its configured effort ladder to the neutral descriptor. */
export function toModelDescriptor(id: string, caps: EffortCaps): ModelDescriptor {
  const levels = caps[id];
  if (levels === undefined || levels.length === 0) return { id };
  return { id, supportsEffort: true, supportedEffortLevels: levels as ClaudeEffort[] };
}

export interface FetchModelsConfig {
  apiKey: string;
  modelsUrl?: string;
  caps?: EffortCaps;
  fetchImpl?: FetchLike;
}

/**
 * Fetch the account's LongCat models (+ configured effort ladders). A non-OK response
 * THROWS (a failed fetch must never be mistaken for a genuinely-empty model list — the
 * model cache only stores a resolved fetch, so a throw self-heals on the next call).
 */
export async function fetchLongCatModels(config: FetchModelsConfig): Promise<ModelDescriptor[]> {
  const url = config.modelsUrl ?? DEFAULT_MODELS_URL;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const caps = config.caps ?? {};
  const res = await doFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(
      `longcat /models failed: HTTP ${res.status}${snippet !== '' ? ` — ${snippet}` : ''}`,
    );
  }
  const parsed = modelsResponseSchema.parse(await res.json());
  return parsed.data.map((model) => toModelDescriptor(model.id, caps));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/adapter-longcat/src/models.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-longcat/src/models.ts packages/adapter-longcat/src/models.test.ts
git commit -m "feat: add LongCat model discovery over the dedicated models endpoint"
```

---

### Task 5: `render.ts` (neutral→system prompt) + complete `index.ts`

The neutral→system-prompt render (identical to DeepSeek's — a pure API has only a system message), and the finished public barrel.

**Files:**
- Create: `packages/adapter-longcat/src/render.ts`
- Test: `packages/adapter-longcat/src/render.test.ts`
- Modify: `packages/adapter-longcat/src/index.ts`

**Interfaces:**
- Produces (`render.ts`): `renderSystemPrompt(neutralConfig: NeutralConfig): string`.
- Produces (`index.ts`): the full public surface (adapter, complete, models, pricing, credentials, render).

- [ ] **Step 1: Write the failing test `packages/adapter-longcat/src/render.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { NeutralConfig } from '@coa/shared';
import { renderSystemPrompt } from './render.js';

function config(): NeutralConfig {
  return {
    prefixHead: [
      {
        order: 1,
        piece: {
          name: 'baseline-tone',
          description: 'd',
          body: 'Be concise.',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
          slot: 'tone',
        },
      },
      {
        order: 0,
        piece: {
          name: 'baseline-identity',
          description: 'd',
          body: 'You are a coa agent.',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
          slot: 'identity',
        },
      },
      {
        order: 2,
        piece: {
          name: 'baseline-environment',
          description: 'd',
          body: 'cwd: /w',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
          slot: 'volatile',
        },
      },
    ],
    systemReminders: [],
    onDemandPullable: [],
    scopePushed: [],
    toolIntents: { allow: [], deny: [] },
  };
}

describe('renderSystemPrompt (LongCat)', () => {
  it('renders every piece as ordered sections with no drop-set and no boundary heading', () => {
    const out = renderSystemPrompt(config());
    expect(out).toBe(
      ['## Identity', 'You are a coa agent.', '## Tone', 'Be concise.', '## Environment', 'cwd: /w'].join('\n\n'),
    );
    expect(out.startsWith('## Identity')).toBe(true);
    expect(out).not.toContain('# coa governance layer');
  });

  it('appends standing-authority reminders after the sections', () => {
    const out = renderSystemPrompt({
      ...config(),
      systemReminders: [{ rule: 'r1', reason: 'because' }],
    });
    expect(out.endsWith('[r1] because')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/adapter-longcat/src/render.test.ts`
Expected: FAIL — cannot resolve `./render.js`.

- [ ] **Step 3: Write `packages/adapter-longcat/src/render.ts`**

```ts
import { renderSections, type NeutralConfig, type Reminder } from '@coa/shared';

/**
 * The neutral→LongCat prompt render. A pure API has only a system message, so this
 * collapses M5's `NeutralConfig` to a single system-prompt string: the most-stable-first
 * prefix (byte-stable — cache invariant honored), rendered into the section skeleton,
 * followed by the standing-authority reminders. LongCat has no preset to defer to, so it
 * renders every Piece — no drop-set, no boundary heading. Pull-only/scope-pushed content
 * is deferred (TAX-1), never folded in.
 */
function renderReminder(reminder: Reminder): string {
  return `[${reminder.rule}] ${reminder.reason}`;
}

export function renderSystemPrompt(neutralConfig: NeutralConfig): string {
  const sections = renderSections(
    [...neutralConfig.prefixHead].sort((a, b) => a.order - b.order).map((ordered) => ordered.piece),
  );
  const authority = neutralConfig.systemReminders.map(renderReminder);
  return authority.length > 0 ? [sections, authority.join('\n')].join('\n\n') : sections;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/adapter-longcat/src/render.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Replace `packages/adapter-longcat/src/index.ts` with the barrel (everything except the adapter)**

The `LongCatAdapter` export is added in Task 6 (when `adapter.ts` exists), so this commit stays buildable.

```ts
/**
 * @coa/adapter-longcat (M9 backend) — the thin LongCat `RuntimeAdapter`. Implements the
 * `complete()` primitive over LongCat's OpenAI-compatible HTTP API and drives the shared
 * `@coa/loop-driver`; everything else (tools, roles, context, the two SC-1 blocks) comes
 * from coa. Imports no provider SDK — just `fetch`.
 */

export {
  makeLongCatComplete,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  type LongCatCompleteConfig,
  type LongCatReasoning,
  type FetchLike,
} from './complete.js';
export {
  fetchLongCatModels,
  loadEffortCaps,
  toModelDescriptor,
  DEFAULT_MODELS_URL,
  EFFORT_ENV_VAR,
  type EffortCaps,
  type FetchModelsConfig,
} from './models.js';
export {
  loadPriceTable,
  toRuntimeUsage,
  DEFAULT_PRICES,
  PRICES_ENV_VAR,
  type ModelPrice,
  type PriceTable,
} from './pricing.js';
export { resolveApiKey, DEFAULT_API_KEY_VAR } from './credentials.js';
export { renderSystemPrompt } from './render.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-longcat/src/render.ts packages/adapter-longcat/src/render.test.ts packages/adapter-longcat/src/index.ts
git commit -m "feat: add LongCat neutral prompt render and public barrel"
```

---

### Task 6: `adapter.ts` (the `RuntimeAdapter`)

The thin adapter class that ties it together: renders native, resolves the key, builds `complete()`, drives `runGovernedLoop`, and degrades every enhancement port to its null-fallback. Maps coa's reasoning selection to the `thinking` toggle.

**Files:**
- Create: `packages/adapter-longcat/src/adapter.ts`
- Test: `packages/adapter-longcat/src/adapter.test.ts`

**Interfaces:**
- Consumes: `renderSystemPrompt`, `resolveApiKey`, `loadPriceTable`, `PriceTable`, `makeLongCatComplete`, `DEFAULT_MODEL`, `LongCatReasoning`, `FetchLike`; `runGovernedLoop` (`@coa/loop-driver`); `barebonesProfile`, `REFS_NULL_FALLBACK` and the SPI/shared types (`@coa/spi`, `@coa/shared`).
- Produces: `class LongCatAdapter implements RuntimeAdapter`, `interface LongCatAdapterInit` (same shape as `DeepSeekAdapterInit`: `sessionId`, `input`, optional `model`, `onSettle`, `onTurn`, `history`, `onBackendMessages`, `locator`, `maxBudgetUsd`, `env`, `baseUrl`, `prices`, `fetchImpl`).

- [ ] **Step 1: Write the failing test `packages/adapter-longcat/src/adapter.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { NeutralConfig, SessionConfig, TurnFrame } from '@coa/shared';
import type { CanUseTool, RegisteredTool, StopPredicate } from '@coa/spi';
import { LongCatAdapter } from './adapter.js';
import type { FetchLike } from './complete.js';

const NEUTRAL: NeutralConfig = {
  prefixHead: [
    {
      order: 0,
      piece: {
        name: 'identity',
        description: 'd',
        body: 'You are a coa agent.',
        axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
      },
    },
  ],
  systemReminders: [],
  onDemandPullable: [],
  scopePushed: [],
  toolIntents: { allow: [], deny: [] },
};

const SESSION: SessionConfig = {
  role: '',
  scope: '',
  worktree: '/w',
  capabilityFrame: { allow: [], deny: [] },
};

const allow: CanUseTool = async () => ({ behavior: 'allow' });
const allowStop: StopPredicate = async () => ({ allow: true });

interface Captured {
  body?: Record<string, unknown>;
}

function textFetch(captured: Captured): FetchLike {
  return async (_url, init) => {
    captured.body = init.body !== undefined ? JSON.parse(init.body) : undefined;
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: 'done' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
    };
  };
}

function wire(adapter: LongCatAdapter): void {
  adapter.renderNative(NEUTRAL);
  adapter.registerTools([]);
  adapter.interceptTool(allow);
  adapter.interceptStop(allowStop);
}

describe('LongCatAdapter', () => {
  it('renders the system prompt, drives the loop, streams frames, and settles usage', async () => {
    const captured: Captured = {};
    const frames: TurnFrame[] = [];
    const onSettle = vi.fn();
    const adapter = new LongCatAdapter({
      sessionId: 's1',
      input: 'refactor the auth module',
      env: { LONGCAT_API_KEY: 'sk-1' },
      prices: { 'LongCat-2.0': { inPerMillion: 0, outPerMillion: 0 } },
      fetchImpl: textFetch(captured),
      onTurn: (f) => frames.push(f),
      onSettle,
    });
    wire(adapter);

    await adapter.runLoop(SESSION);

    expect(captured.body?.['model']).toBe('LongCat-2.0');
    expect(captured.body?.['messages']).toEqual([
      { role: 'system', content: 'You are a coa agent.' },
      { role: 'user', content: 'refactor the auth module' },
    ]);
    expect(frames).toContainEqual({ t: 'text', text: 'done' });
    expect(onSettle).toHaveBeenCalledExactlyOnceWith('s1', {
      tokensIn: 3,
      tokensOut: 2,
      costUsd: 0,
    });
    expect(adapter.usageTelemetry()).toMatchObject({ tokensIn: 3, tokensOut: 2 });
  });

  it('maps an effort selection onto thinking enabled, and off onto disabled', async () => {
    const enabled: Captured = {};
    const on = new LongCatAdapter({
      sessionId: 's1',
      input: 'go',
      model: { provider: 'longcat', model: 'LongCat-2.0', reasoning: { mode: 'effort', effort: 'max' } },
      env: { LONGCAT_API_KEY: 'sk-1' },
      fetchImpl: textFetch(enabled),
    });
    wire(on);
    await on.runLoop(SESSION);
    expect(enabled.body?.['thinking']).toEqual({ type: 'enabled' });

    const disabled: Captured = {};
    const off = new LongCatAdapter({
      sessionId: 's1',
      input: 'go',
      model: { provider: 'longcat', model: 'LongCat-2.0', reasoning: { mode: 'off' } },
      env: { LONGCAT_API_KEY: 'sk-1' },
      fetchImpl: textFetch(disabled),
    });
    wire(off);
    await off.runLoop(SESSION);
    expect(disabled.body?.['thinking']).toEqual({ type: 'disabled' });
  });

  it('fails (SC-1 surfaces upstream) when no API key resolves', async () => {
    const adapter = new LongCatAdapter({ sessionId: 's1', input: 'go', env: {} });
    wire(adapter);
    await expect(adapter.runLoop(SESSION)).rejects.toThrow('no API key');
  });

  it('requires renderNative before runLoop', async () => {
    const adapter = new LongCatAdapter({
      sessionId: 's1',
      input: 'go',
      env: { LONGCAT_API_KEY: 'k' },
    });
    adapter.interceptTool(allow);
    adapter.interceptStop(allowStop);
    await expect(adapter.runLoop(SESSION)).rejects.toThrow('renderNative');
  });

  it('forwards a registered base tool onto the wire tools list', async () => {
    const captured: Captured = {};
    const readTool: RegisteredTool = {
      name: 'Read',
      description: 'Read a file',
      partition: 'kernel',
      inputSchema: {},
      invoke: async () => ({ result: { ok: true }, handle: 'raw:Read', pointer: 'p:Read' }),
    };
    const adapter = new LongCatAdapter({
      sessionId: 's1',
      input: 'go',
      env: { LONGCAT_API_KEY: 'sk-1' },
      fetchImpl: textFetch(captured),
    });
    adapter.renderNative(NEUTRAL);
    adapter.registerTools([readTool]);
    adapter.interceptTool(allow);
    adapter.interceptStop(allowStop);

    await adapter.runLoop(SESSION);

    const tools = captured.body?.['tools'] as Array<{ function: { name: string } }> | undefined;
    expect(tools?.map((t) => t.function.name)).toContain('Read');
  });

  it('reports the barebones capability profile and the refs null-fallback', () => {
    const adapter = new LongCatAdapter({ sessionId: 's1', input: 'go' });
    expect(adapter.capabilityProfile().ports.refs.present).toBe(false);
    expect(adapter.refs({ name: 'x' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/adapter-longcat/src/adapter.test.ts`
Expected: FAIL — cannot resolve `./adapter.js`.

- [ ] **Step 3: Write `packages/adapter-longcat/src/adapter.ts`**

```ts
import type {
  BackendMessage,
  CapabilityProfile,
  ContextPackage,
  Locator,
  ModelSelection,
  NeutralConfig,
  Piece,
  Reminder,
  SessionConfig,
  SymbolRef,
  TurnFrame,
} from '@coa/shared';
import type {
  BackendConfig,
  CacheBreakpoints,
  CanUseTool,
  EvalCorpus,
  EvalResult,
  ReminderAt,
  RuntimeAdapter,
  RuntimeUsage,
  StopPredicate,
  SymbolReference,
  ToolCatalogue,
} from '@coa/spi';
import { barebonesProfile, REFS_NULL_FALLBACK } from '@coa/spi';
import { runGovernedLoop } from '@coa/loop-driver';
import { renderSystemPrompt } from './render.js';
import { resolveApiKey } from './credentials.js';
import { loadPriceTable, type PriceTable } from './pricing.js';
import {
  makeLongCatComplete,
  DEFAULT_MODEL,
  type LongCatReasoning,
  type FetchLike,
} from './complete.js';

/**
 * The LongCat backend — a **thin** `RuntimeAdapter`. All the agentic machinery lives in
 * the shared {@link runGovernedLoop} driver; this adapter only renders the neutral config
 * to a system prompt, resolves the API key from the account's pointer, builds the
 * `complete()` primitive, and hands the loop the two SC-1 predicates. Every enhancement
 * port degrades to its null-fallback (barebones profile). It imports no provider SDK.
 */

const NO_USAGE: RuntimeUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

export interface LongCatAdapterInit {
  sessionId: string;
  /** The session's prompt input (neutral); the one-shot prompt is the first turn. */
  input: string | AsyncIterable<string>;
  model?: ModelSelection;
  /** M9's settlement step → M7.charge, called once with the loop's summed usage. */
  onSettle?: (sessionId: string, usage: RuntimeUsage) => void;
  /** Per-frame session output → M8's emission policy. */
  onTurn?: (frame: TurnFrame) => void;
  /** The prior conversation transcript (R-7, system omitted), resent verbatim for cross-turn memory. */
  history?: readonly BackendMessage[];
  /** Report the settled transcript so M8 can persist it as the next turn's `history`. */
  onBackendMessages?: (messages: readonly BackendMessage[]) => void;
  /** The account's login pointer (an env-var/key-file pointer); absent ⇒ the default key var. */
  locator?: Locator;
  /** Accepted for D121 parity; a raw chat API has no native mid-loop hard stop. */
  maxBudgetUsd?: number;
  /** Injectable seams (tests / config). */
  env?: Record<string, string | undefined>;
  baseUrl?: string;
  prices?: PriceTable;
  fetchImpl?: FetchLike;
}

/**
 * Map coa's faithful reasoning selection to LongCat's real surface: `off` → thinking
 * disabled; any effort → thinking enabled; `budget`/absent → the model default (nothing
 * sent). LongCat has no graded `reasoning_effort`, so effort level is not forwarded.
 */
function toLongCatReasoning(
  reasoning: ModelSelection['reasoning'],
): LongCatReasoning | undefined {
  if (reasoning === undefined) return undefined;
  if (reasoning.mode === 'off') return { kind: 'disabled' };
  if (reasoning.mode === 'effort') return { kind: 'enabled' };
  return undefined;
}

/** The one-shot prompt: a string as-is, or the first turn of a stream. */
async function firstPrompt(input: string | AsyncIterable<string>): Promise<string> {
  if (typeof input === 'string') return input;
  for await (const chunk of input) return chunk;
  return '';
}

export class LongCatAdapter implements RuntimeAdapter {
  readonly #init: LongCatAdapterInit;
  #backend: BackendConfig | undefined;
  #canUseTool: CanUseTool | undefined;
  #stopPredicate: StopPredicate | undefined;
  #catalogue: ToolCatalogue = [];
  #lastUsage: RuntimeUsage = NO_USAGE;

  constructor(init: LongCatAdapterInit) {
    this.#init = init;
  }

  renderNative(neutralConfig: NeutralConfig): BackendConfig {
    this.#backend = {
      systemPrompt: renderSystemPrompt(neutralConfig),
      allowedTools: neutralConfig.toolIntents.allow,
      disallowedTools: neutralConfig.toolIntents.deny,
      perAgent: {},
      files: [],
    };
    return this.#backend;
  }

  registerTools(catalogue: ToolCatalogue): void {
    this.#catalogue = catalogue;
  }

  /** A pure chat API has no built-in tools to demote — coa supplies every tool. */
  denyBuiltins(): void {}

  interceptTool(canUseTool: CanUseTool): void {
    this.#canUseTool = canUseTool;
  }

  interceptStop(stopPredicate: StopPredicate): void {
    this.#stopPredicate = stopPredicate;
  }

  async runLoop(_sessionConfig: SessionConfig): Promise<void> {
    const backend = this.#backend;
    if (backend === undefined)
      throw new Error('runLoop: renderNative must be called before runLoop');
    if (this.#canUseTool === undefined || this.#stopPredicate === undefined) {
      throw new Error('runLoop: interceptTool and interceptStop must be called before runLoop');
    }
    const apiKey = resolveApiKey(this.#init.locator, this.#init.env);
    if (apiKey === undefined) {
      throw new Error('longcat: no API key — set LONGCAT_API_KEY or add an env-var account');
    }
    const reasoning = toLongCatReasoning(this.#init.model?.reasoning);
    const complete = makeLongCatComplete({
      apiKey,
      model: this.#init.model?.model ?? DEFAULT_MODEL,
      prices: this.#init.prices ?? loadPriceTable(this.#init.env),
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(this.#init.baseUrl !== undefined ? { baseUrl: this.#init.baseUrl } : {}),
      ...(this.#init.fetchImpl !== undefined ? { fetchImpl: this.#init.fetchImpl } : {}),
    });
    await runGovernedLoop({
      sessionId: this.#init.sessionId,
      complete,
      catalogue: this.#catalogue,
      systemPrompt: backend.systemPrompt,
      input: await firstPrompt(this.#init.input),
      ...(this.#init.history !== undefined ? { history: this.#init.history } : {}),
      canUseTool: this.#canUseTool,
      gate: this.#stopPredicate,
      ...(this.#init.onTurn !== undefined ? { onTurn: this.#init.onTurn } : {}),
      ...(this.#init.onBackendMessages !== undefined
        ? { onMessages: this.#init.onBackendMessages }
        : {}),
      onSettle: (sessionId, usage) => {
        this.#lastUsage = usage;
        this.#init.onSettle?.(sessionId, usage);
      },
    });
  }

  usageTelemetry(): RuntimeUsage {
    return this.#lastUsage;
  }

  // --- Enhancement ports: LongCat runs the neutral floor; each degrades to its null-fallback. ---

  deliverReminder(_reminder: Reminder, _at: ReminderAt): void {}
  render_context(_pkg: ContextPackage): void {}
  inject_runtime(_slice: readonly Piece[]): void {}
  cache_control(_breakpoints: CacheBreakpoints): void {}

  capabilityProfile(): CapabilityProfile {
    return barebonesProfile;
  }

  refs(_symbol: SymbolRef): SymbolReference[] | null {
    return REFS_NULL_FALLBACK;
  }

  async runEval(_corpus: EvalCorpus): Promise<EvalResult> {
    return { passed: 0, failed: 0 };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/adapter-longcat/src/adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the adapter export to `packages/adapter-longcat/src/index.ts`**

Add this line at the top of the export block (after the doc comment):

```ts
export { LongCatAdapter, type LongCatAdapterInit } from './adapter.js';
```

- [ ] **Step 6: Build the package to confirm the barrel type-checks end to end**

Run: `pnpm --filter @coa/adapter-longcat build`
Expected: succeeds; `dist/index.d.ts` produced (the barrel now resolves `./adapter.js`).

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-longcat/src/adapter.ts packages/adapter-longcat/src/adapter.test.ts packages/adapter-longcat/src/index.ts
git commit -m "feat: add the thin LongCat runtime adapter"
```

---

### Task 7: Register `longcat` as a provider + wire the adapter factory

Adds `longcat` to the shared provider enum and routes it in the app-side adapter factory (the one place backends are constructed).

**Files:**
- Modify: `packages/shared/src/auth.ts:32`
- Modify: `apps/cli/src/adapter-factory.ts`
- Test: `apps/cli/src/adapter-factory.test.ts`

**Interfaces:**
- Consumes: `LongCatAdapter`, `fetchLongCatModels`, `loadEffortCaps`, `resolveApiKey` (`@coa/adapter-longcat`); `SessionAdapterInit`, `ModelCacheAccount` (`@coa/core`).
- Produces: `createLongCatAdapter(init: SessionAdapterInit): RuntimeAdapter`; `createAdapter`/`fetchModels` now route `provider: 'longcat'`.

- [ ] **Step 1: Add `'longcat'` to the provider enum in `packages/shared/src/auth.ts`**

Change line 31–32 to:

```ts
/** The backends an account can point at. `claude` = subscription login; `deepseek`/`longcat` = API-key providers. */
export const providerSchema = z.enum(['claude', 'deepseek', 'longcat']);
```

- [ ] **Step 2: Write the failing test — append to `apps/cli/src/adapter-factory.test.ts`**

Add these imports at the top (extend the existing import from `./adapter-factory.js`):

```ts
import { createClaudeAdapter, createLongCatAdapter, fetchModels } from './adapter-factory.js';
```

Add this describe block at the end of the file:

```ts
describe('createLongCatAdapter', () => {
  it('constructs a runtime adapter advertising the barebones capability floor', () => {
    const adapter = createLongCatAdapter(init({ model: { provider: 'longcat', model: 'LongCat-2.0' } }));
    expect(adapter.capabilityProfile().spiVersion).toBeDefined();
    expect(typeof adapter.runLoop).toBe('function');
  });
});

describe('fetchModels — longcat', () => {
  it('throws (rather than silently returning []) when no key resolves from the locator', async () => {
    await expect(
      fetchModels({
        label: 'lc-ambient',
        provider: 'longcat',
        locator: { type: 'env-var', name: 'COA_TEST_UNSET_LONGCAT_KEY_XYZ' },
      }),
    ).rejects.toThrow(/no api key resolved/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/cli/src/adapter-factory.test.ts`
Expected: FAIL — `createLongCatAdapter` is not exported / `longcat` not routed.

- [ ] **Step 4: Wire `apps/cli/src/adapter-factory.ts`**

Add the import block after the existing `@coa/adapter-deepseek` import:

```ts
import {
  LongCatAdapter,
  fetchLongCatModels,
  loadEffortCaps as loadLongCatEffortCaps,
  resolveApiKey as resolveLongCatApiKey,
} from '@coa/adapter-longcat';
```

Add a `case 'longcat'` to the `createAdapter` switch (before `default:`):

```ts
    case 'longcat':
      return createLongCatAdapter(init);
```

Extend the `fetchModels` provider routing (replace the ternary at ~line 44–47):

```ts
  const models =
    provider === 'deepseek'
      ? await fetchDeepSeekFor(account)
      : provider === 'longcat'
        ? await fetchLongCatFor(account)
        : await fetchClaudeModels(account.locator);
  return models.map((model) => ({ ...model, provider }));
```

Add these two functions (next to `fetchDeepSeekFor` / `createDeepSeekAdapter`):

```ts
async function fetchLongCatFor(account: ModelCacheAccount): Promise<ModelDescriptor[]> {
  const apiKey = resolveLongCatApiKey(account.locator);
  if (apiKey === undefined) {
    throw new Error('longcat: no API key resolved from the account locator');
  }
  return fetchLongCatModels({ apiKey, caps: loadLongCatEffortCaps() });
}

/** Construct the thin LongCat backend, mapping M8's neutral init onto its init. */
export function createLongCatAdapter(init: SessionAdapterInit): RuntimeAdapter {
  return new LongCatAdapter({
    sessionId: init.sessionId,
    input: init.input,
    onSettle: init.onSettle,
    ...(init.model !== undefined ? { model: init.model } : {}),
    ...(init.onTurn !== undefined ? { onTurn: init.onTurn } : {}),
    ...(init.maxBudgetUsd !== undefined ? { maxBudgetUsd: init.maxBudgetUsd } : {}),
    ...(init.locator !== undefined ? { locator: init.locator } : {}),
    ...(init.history !== undefined ? { history: init.history } : {}),
    ...(init.onBackendMessages !== undefined
      ? { onBackendMessages: init.onBackendMessages }
      : {}),
  });
}
```

Update the factory doc comment (lines ~19–21) to mention `longcat` alongside `deepseek`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run apps/cli/src/adapter-factory.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/auth.ts apps/cli/src/adapter-factory.ts apps/cli/src/adapter-factory.test.ts
git commit -m "feat: register LongCat as a selectable backend provider"
```

---

### Task 8: `coa auth add` LongCat flags + REPO_LAYOUT doc

Adds parallel `--longcat-key` / `--longcat-env-var` flags to the auth CLI (mirroring DeepSeek's) and records the new package in the layout doc (same-commit rule).

**Files:**
- Modify: `apps/cli/src/auth-cli.ts`
- Test: `apps/cli/src/auth-cli.test.ts`
- Modify: `docs/REPO_LAYOUT.md`

**Interfaces:**
- Consumes: existing `runAdd` helpers (`writeKeyFile`, `ENV_VAR_NAME`, `fail`) and `reg.add`.
- Produces: `--longcat-key <KEY>` (registers a `key-file` locator, provider `longcat`) and `--longcat-env-var <NAME>` (registers an `env-var` locator, provider `longcat`).

- [ ] **Step 1: Write the failing tests — append to `apps/cli/src/auth-cli.test.ts`**

Add these `it` blocks inside the existing `describe('runAuthCommand', ...)`:

```ts
  it('current lists longcat as ambient too', () => {
    expect(runAuthCommand(['current'], io(), home)).toBe(0);
    expect(out).toContain('longcat\tambient');
  });

  it('add --longcat-key writes a 0600 key file and stores a longcat key-file pointer', () => {
    expect(runAuthCommand(['add', 'lc', '--longcat-key', 'sk-secret'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['list'], io(), home);
    expect(out.join('\n')).toMatch(/lc\tlongcat\tkey-file/);
    expect(out.join('\n')).not.toContain('sk-secret');
    expect(readFileSync(join(home, '.coa', 'keys', 'lc'), 'utf8')).toBe('sk-secret');
  });

  it('add --longcat-env-var rejects a key-looking value and accepts a real var name', () => {
    expect(runAuthCommand(['add', 'lc', '--longcat-env-var', 'sk-e91530'], io(), home)).toBe(1);
    expect(err.join('')).toMatch(/looks like a key/);
    err = [];
    expect(runAuthCommand(['add', 'lc', '--longcat-env-var', 'LONGCAT_API_KEY'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['list'], io(), home);
    expect(out.join('\n')).toMatch(/lc\tlongcat\tenv-var LONGCAT_API_KEY/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run apps/cli/src/auth-cli.test.ts`
Expected: FAIL — the `--longcat-*` flags fall through to the `ADD_USAGE` error.

- [ ] **Step 3: Wire the flags in `apps/cli/src/auth-cli.ts`**

Update `ADD_USAGE` (line ~75–76):

```ts
const ADD_USAGE =
  'usage: coa auth add <label> --config-dir <dir> | --env-var <NAME> | --deepseek-key <KEY> | --longcat-env-var <NAME> | --longcat-key <KEY>';
```

In `runAdd`, add these two branches before the final `return fail(io, ADD_USAGE);`:

```ts
  if (flag === '--longcat-env-var') {
    if (!ENV_VAR_NAME.test(value)) {
      return fail(
        io,
        `'${value}' looks like a key, not a variable name. To store the key itself: coa auth add ${label} --longcat-key <KEY>. To point at an env var, pass its NAME (e.g. LONGCAT_API_KEY).`,
      );
    }
    reg.add(label, { type: 'env-var', name: value }, 'longcat');
    return 0;
  }
  if (flag === '--longcat-key') {
    const path = writeKeyFile(home, label, value);
    reg.add(label, { type: 'key-file', path }, 'longcat');
    return 0;
  }
```

Update the file's header doc comment to note the LongCat flags alongside DeepSeek's.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run apps/cli/src/auth-cli.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Record the package in `docs/REPO_LAYOUT.md`**

After the `adapter-deepseek/` line (~25) in the package tree, add:

```
    adapter-longcat/         M9 impl  — @coa/adapter-longcat (thin pure-API backend: LongCat `complete()` over HTTP + the shared loop-driver; no backend SDK, just fetch)
```

In the M9 row of the module table (~62), append `+ @coa/adapter-longcat` to the packages list and `+ the thin LongCat backend` to the description.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/auth-cli.ts apps/cli/src/auth-cli.test.ts docs/REPO_LAYOUT.md
git commit -m "feat: add LongCat account flags to the auth CLI"
```

---

### Task 9: Full gate + live smoke test

Runs the whole repo verification gate, then a real call against the LongCat API to confirm the two deferred unknowns (the `/models` path and the usage cache-field name) and one tool-calling round-trip.

**Files:**
- Create (scratch, NOT committed): `<scratchpad>/longcat-smoke.mjs`
- Possibly modify: `packages/adapter-longcat/src/wire.ts` / `pricing.ts` (only if the live usage field differs)

- [ ] **Step 1: Run the full repo gate**

Run: `pnpm check`
Expected: `typecheck`, `lint`, `format`, `test`, and `depcruise` all pass. (`depcruise` confirms the new adapter respects backend-isolation — it imports no backend SDK.)

Note: if `format` flags the new files, run `pnpm format:write` and amend the relevant commit.

- [ ] **Step 2: Write the scratch smoke script `<scratchpad>/longcat-smoke.mjs`**

```js
// Live smoke — run with: LONGCAT_API_KEY=sk-... node longcat-smoke.mjs
const key = process.env.LONGCAT_API_KEY;
if (!key) throw new Error('set LONGCAT_API_KEY');
const auth = { authorization: `Bearer ${key}` };

// 1) Confirm the models path prefix.
const models = await fetch('https://api.longcat.chat/v1/models', { headers: auth });
console.log('MODELS', models.status, JSON.stringify(await models.json()).slice(0, 400));

// 2) One tool-calling round-trip; log the raw usage block to lock the cache-field name.
const chat = await fetch('https://api.longcat.chat/openai/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...auth },
  body: JSON.stringify({
    model: 'LongCat-2.0',
    messages: [{ role: 'user', content: 'What is 2+2? Use the add tool.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'add',
          description: 'Add two integers',
          parameters: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b'],
          },
        },
      },
    ],
  }),
});
const body = await chat.json();
console.log('CHAT', chat.status);
console.log('TOOL_CALLS', JSON.stringify(body.choices?.[0]?.message?.tool_calls));
console.log('USAGE', JSON.stringify(body.usage));
```

- [ ] **Step 3: Run the smoke script with the maintainer's key**

Run: `LONGCAT_API_KEY=<key> node <scratchpad>/longcat-smoke.mjs`
Expected:
- `MODELS 200` and the payload includes a `LongCat-2.0` id → confirms `DEFAULT_MODELS_URL`.
- `TOOL_CALLS` is a non-null array with `function.name === 'add'` → confirms the OpenAI function-call round-trip.
- `USAGE` printed → read the cache-token field name.

- [ ] **Step 4: Reconcile the wire schema if the live usage differs**

If the `USAGE` block does NOT carry `prompt_tokens_details.cached_tokens` (e.g. it uses a flat field, or the `/models` path was `/openai/v1/models`):
- Update `wireUsageSchema` (and `toRuntimeUsage`'s `cacheHit` read) in `wire.ts`/`pricing.ts`, or `DEFAULT_MODELS_URL` in `models.ts`, to the real shape.
- Re-run the affected unit tests (`pnpm exec vitest run packages/adapter-longcat`) and adjust their fixtures to match.
- Commit: `git add packages/adapter-longcat/src/... && git commit -m "fix: match LongCat live usage/model-list shape"`

If everything matched, no code change — the smoke script is scratch and is not committed.

- [ ] **Step 5: Final verification**

Run: `pnpm exec vitest run packages/adapter-longcat apps/cli/src/adapter-factory.test.ts apps/cli/src/auth-cli.test.ts`
Expected: all green. LongCat is now a selectable, governed backend.

---

## Notes for the implementer

- **Read order independence:** every task pastes its full file content; do not assume you have seen a neighbouring task.
- **No `core` branch on `longcat`:** memory replay works automatically because `planMemory` branches on `isClaude` (LongCat rides the non-Claude pure-API path). Do not add a `longcat` case to `packages/core`.
- **Name clash in the factory:** `@coa/adapter-deepseek` and `@coa/adapter-longcat` both export `resolveApiKey`/`loadEffortCaps`. Task 7 imports the LongCat ones under aliases (`resolveLongCatApiKey`, `loadLongCatEffortCaps`) — keep those aliases.
- **Secrets:** the smoke script and the key never get committed. Store the key only in the `LONGCAT_API_KEY` env var for the run.

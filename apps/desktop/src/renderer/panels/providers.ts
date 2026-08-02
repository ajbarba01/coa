import type { BrandMarkSpec } from '@coa/console-kit';
import {
  CLAUDE_MARK,
  CODEX_MARK,
  DEEPSEEK_MARK,
  EXA_MARK,
  FIRECRAWL_MARK,
  GEMINI_MARK,
  LONGCAT_MARK,
  PARALLEL_MARK,
  TAVILY_MARK,
} from './providerMarks.js';

/**
 * The provider descriptor registry — the ONE thing that has to change to teach the
 * console a new provider. Every auth/usage surface renders off these rows, and the
 * add-flow branches on `locator`, never on `id`: a new provider is a row here plus an
 * adapter, and no new component.
 *
 * Official marks are the CC0 Simple Icons paths; anyone we ship no mark for degrades to
 * a monogram tile (BrandMark's floor), which is what keeps "a row is enough" true.
 */

/** How a credential is REACHED. The add-flow has one form per kind — four, forever. */
export type LocatorKind = 'key-file' | 'config-dir' | 'env-var' | 'ambient' | 'cli-login';

/** Backends run the agent (pick ONE active — identity-shaped). Services are used BY the
 *  agent (a live pool per chain with failover — capacity-shaped). The asymmetry is real,
 *  so the surface leans into it rather than papering over it. */
export type ProviderGroup = 'backend' | 'service';

export interface ProviderDescriptor {
  id: string;
  /** The vendor's own casing, for display only. `id` is the value that travels. */
  label: string;
  group: ProviderGroup;
  locator: LocatorKind;
  mark: BrandMarkSpec;
  /** What one credential is called here — a `config-dir` provider has logins, a keyed one has keys. */
  noun: 'login' | 'key';
  /** Shown in the add-form: where the secret/pointer ends up. */
  hint: string;
  /** The adapter/SDK version coa drives this provider through, where one applies —
   *  worn in the detail subtitle, absent when there is nothing honest to show. */
  version?: string;
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'claude',
    label: 'Claude',
    group: 'backend',
    locator: 'config-dir',
    noun: 'login',
    mark: CLAUDE_MARK,
    hint: 'coa stores a pointer, not a credential. The login lives in that directory, owned by Claude.',
    version: 'Agent SDK 0.72',
  },
  {
    id: 'codex',
    label: 'Codex',
    group: 'backend',
    locator: 'cli-login',
    noun: 'login',
    mark: CODEX_MARK,
    hint: 'Run `codex login` against this profile. The token it writes is detected when it lands.',
    version: 'CLI 0.48',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    group: 'backend',
    locator: 'key-file',
    noun: 'key',
    mark: DEEPSEEK_MARK,
    hint: 'Written 0600 under ~/.coa/keys. Never read back, never logged, never returned by a read.',
    version: 'API v3',
  },
  {
    id: 'longcat',
    label: 'LongCat',
    group: 'backend',
    locator: 'key-file',
    noun: 'key',
    mark: LONGCAT_MARK,
    hint: 'Written 0600 under ~/.coa/keys. Never read back, never logged, never returned by a read.',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    group: 'backend',
    locator: 'env-var',
    noun: 'key',
    mark: GEMINI_MARK,
    hint: 'coa stores the variable name, not its value. The environment is read at session start.',
    version: 'API v1beta',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    group: 'service',
    locator: 'key-file',
    noun: 'key',
    mark: TAVILY_MARK,
    hint: 'Written 0600 under ~/.coa/web-keys. Never read back, never logged.',
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    group: 'service',
    locator: 'key-file',
    noun: 'key',
    mark: FIRECRAWL_MARK,
    hint: 'Written 0600 under ~/.coa/web-keys. Never read back, never logged.',
  },
  {
    id: 'parallel',
    label: 'Parallel',
    group: 'service',
    locator: 'key-file',
    noun: 'key',
    mark: PARALLEL_MARK,
    hint: 'Written 0600 under ~/.coa/web-keys. Never read back, never logged.',
  },
  {
    id: 'exa',
    label: 'Exa',
    group: 'service',
    locator: 'key-file',
    noun: 'key',
    mark: EXA_MARK,
    hint: 'Written 0600 under ~/.coa/web-keys. Never read back, never logged.',
  },
];

export function providerById(id: string): ProviderDescriptor | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Whether a locator stores a POINTER (a path, a variable name — readable, showable,
 *  editable) rather than a secret (write-only: masked on store, replaced never edited). */
export function isPointerLocator(locator: LocatorKind | undefined): boolean {
  return locator === 'config-dir' || locator === 'env-var';
}

/** The label a locator kind wears in the add-flow. The FORM is chosen by this, not by provider.
 *  The key is the VALUE; only the string is displayed. Its FIRST WORD is also the provider
 *  tile's badge, sharing that slot with `Added` — the two have to be cased alike. */
export const LOCATOR_LABEL: Record<LocatorKind, string> = {
  'key-file': 'API key',
  'config-dir': 'Config directory',
  'env-var': 'Environment variable',
  ambient: 'Ambient login',
  'cli-login': 'CLI login',
};

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

/** One model a backend can run. Mock-fed today (the real list is a per-provider read
 *  through the M9 port — only Claude's exists live); visibility is the user's, in mockAuth. */
export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderDescriptor {
  id: string;
  label: string;
  group: ProviderGroup;
  locator: LocatorKind;
  mark: BrandMarkSpec;
  /** What one credential is called here — a `config-dir` provider has logins, a keyed one has keys. */
  noun: 'login' | 'key';
  /** Shown in the add-form: where the secret/pointer ends up. */
  hint: string;
  /** The models this backend offers (backends only — a tool service has no models). */
  models?: ProviderModel[];
  /** The adapter/SDK version coa drives this provider through, where one applies —
   *  worn in the detail subtitle, absent when there is nothing honest to show. */
  version?: string;
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'claude',
    label: 'claude',
    group: 'backend',
    locator: 'config-dir',
    noun: 'login',
    mark: CLAUDE_MARK,
    hint: 'coa stores a pointer, not a credential — the login lives in that directory, owned by Claude.',
    version: 'agent sdk 0.72',
    // The subscription honors explicit older ids too, so the long tail is real access,
    // not decoration — hiding it is exactly what the picker visibility is for.
    models: [
      { id: 'claude-fable-5', label: 'fable 5' },
      { id: 'claude-opus-4-8', label: 'opus 4.8' },
      { id: 'claude-sonnet-5', label: 'sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'haiku 4.5' },
      { id: 'claude-opus-4-7', label: 'opus 4.7' },
      { id: 'claude-sonnet-4-6', label: 'sonnet 4.6' },
      { id: 'claude-opus-4-1', label: 'opus 4.1' },
      { id: 'claude-sonnet-4-0', label: 'sonnet 4' },
      { id: 'claude-haiku-3-5', label: 'haiku 3.5' },
    ],
  },
  {
    id: 'codex',
    label: 'codex',
    group: 'backend',
    locator: 'cli-login',
    noun: 'login',
    mark: CODEX_MARK,
    hint: 'Run `codex login` against this profile; coa watches for the token it writes.',
    version: 'cli 0.48',
    models: [
      { id: 'gpt-5.2-codex', label: 'gpt-5.2 codex' },
      { id: 'gpt-5.2', label: 'gpt-5.2' },
      { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1 codex mini' },
    ],
  },
  {
    id: 'deepseek',
    label: 'deepseek',
    group: 'backend',
    locator: 'key-file',
    noun: 'key',
    mark: DEEPSEEK_MARK,
    hint: 'Written 0600 under ~/.coa/keys. Never read back, never logged, never returned by a read.',
    version: 'api v3',
    models: [
      { id: 'deepseek-chat', label: 'deepseek chat' },
      { id: 'deepseek-reasoner', label: 'deepseek reasoner' },
    ],
  },
  {
    id: 'longcat',
    label: 'longcat',
    group: 'backend',
    locator: 'key-file',
    noun: 'key',
    mark: LONGCAT_MARK,
    hint: 'Written 0600 under ~/.coa/keys. Never read back, never logged, never returned by a read.',
    models: [
      { id: 'longcat-flash-chat', label: 'longcat flash chat' },
      { id: 'longcat-flash-thinking', label: 'longcat flash thinking' },
    ],
  },
  {
    id: 'gemini',
    label: 'gemini',
    group: 'backend',
    locator: 'env-var',
    noun: 'key',
    mark: GEMINI_MARK,
    hint: 'coa stores the VARIABLE NAME and reads it from the environment at session start.',
    version: 'api v1beta',
    models: [
      { id: 'gemini-2.5-pro', label: 'gemini 2.5 pro' },
      { id: 'gemini-2.5-flash', label: 'gemini 2.5 flash' },
      { id: 'gemini-2.5-flash-lite', label: 'gemini 2.5 flash lite' },
      { id: 'gemini-2.0-flash', label: 'gemini 2.0 flash' },
      { id: 'gemini-1.5-pro', label: 'gemini 1.5 pro' },
      { id: 'gemini-1.5-flash', label: 'gemini 1.5 flash' },
    ],
  },
  {
    id: 'tavily',
    label: 'tavily',
    group: 'service',
    locator: 'key-file',
    noun: 'key',
    mark: TAVILY_MARK,
    hint: 'Written 0600 under ~/.coa/web-keys. Never read back, never logged.',
  },
  {
    id: 'firecrawl',
    label: 'firecrawl',
    group: 'service',
    locator: 'key-file',
    noun: 'key',
    mark: FIRECRAWL_MARK,
    hint: 'Written 0600 under ~/.coa/web-keys. Never read back, never logged.',
  },
  {
    id: 'parallel',
    label: 'parallel',
    group: 'service',
    locator: 'key-file',
    noun: 'key',
    mark: PARALLEL_MARK,
    hint: 'Written 0600 under ~/.coa/web-keys. Never read back, never logged.',
  },
  {
    id: 'exa',
    label: 'exa',
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

/** The label a locator kind wears in the add-flow. The FORM is chosen by this, not by provider. */
export const LOCATOR_LABEL: Record<LocatorKind, string> = {
  'key-file': 'api key',
  'config-dir': 'config directory',
  'env-var': 'environment variable',
  ambient: 'ambient login',
  'cli-login': 'cli login',
};

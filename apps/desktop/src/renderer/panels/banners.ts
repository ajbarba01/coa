import type { Banner, ModelSelection } from '@coa/console-viewmodel';

/**
 * Predictive chat banners — computed live in the console from what a send WOULD do,
 * not emitted by the daemon after the fact. Two derived, side-effect-free notices:
 *
 *  - **cache** (informational): the pending model/provider differs from what the
 *    session last ran on (a cold prompt cache), or the session has sat idle past its
 *    provider's cache TTL. It offers no fix — an idle cache cannot be un-cooled — so its
 *    only control is Dismiss, keyed to what it was raised for. It also clears on its own
 *    when the pending selection matches the pinned one again (a send, or a revert).
 *  - **drift** (actionable): the config a send would use no longer matches the config
 *    the RUNNING (frozen) prompt was compiled from. It offers `recompile` and is
 *    dismissable; it persists until dismissed or the config matches the prompt again.
 */

/** The drift-relevant slice of a prompt config (role selection + package selection). */
export interface PromptConfigView {
  roles?: readonly string[] | undefined;
  packageIds?: readonly string[] | undefined;
  exclude?: readonly string[] | undefined;
}

/** Per-provider prompt-cache TTL (ms) — the idle window past which a session is cold.
 *  Claude 5 min; a provider absent here ⇒ staleness off (e.g. DeepSeek). */
const STALENESS_MS: Record<string, number> = { claude: 5 * 60_000 };

/** A canonical key for a prompt config (sorted-unique roles + packages/exclusions),
 *  so two configs compare structurally and a drift dismissal can be keyed to one.
 *  Role selection order never spuriously trips drift. */
export function configKey(config: PromptConfigView | undefined): string {
  const norm = (ids: readonly string[] | undefined): string[] => [...new Set(ids ?? [])].sort();
  return JSON.stringify({
    roles: norm(config?.roles),
    packageIds: norm(config?.packageIds),
    exclude: norm(config?.exclude),
  });
}

/** A console-local extension of the M0 wire shape: `summary` is the one clause the
 *  notice shows permanently, while `reason` stays the full explanation behind proximity.
 *  It lives here rather than on `bannerSchema` because these notices are DERIVED in the
 *  console, never sent by the daemon — nothing crosses a wire, so nothing needs a schema
 *  change. */
export interface ChatNotice extends Banner {
  summary: string;
}

const DRIFT_BANNER: ChatNotice = {
  id: 'drift',
  kind: 'drift',
  summary: 'The agent configuration changed after this prompt compiled.',
  reason:
    'The agent configuration changed while a compiled prompt is running, so the active ' +
    'prompt still reflects the earlier configuration. Recompile to apply the change, ' +
    'or dismiss to keep the current prompt.',
  actions: [{ id: 'recompile', label: 'Recompile', primary: true }],
};

/** The short line, built from the same reasons that build the full sentence: capital
 *  first, terminal period, one clause per reason. */
function cacheSummary(reasons: readonly string[]): string {
  const said = reasons.map((r) => `${r.charAt(0).toUpperCase()}${r.slice(1)}.`);
  return said.join(' ');
}

function cacheBanner(reasons: readonly string[]): ChatNotice {
  return {
    id: 'cache',
    kind: 'cache',
    summary: cacheSummary(reasons),
    reason: `The next message will start with a cold prompt cache (${reasons.join(
      ', ',
    )}), so it may be slower and cost more.`,
  };
}

/** A canonical key for what the cache notice was raised ABOUT — the staged pick and the
 *  session's pin. Dismissing stores this key, so the notice stays down until one of them
 *  actually moves; idle time alone never re-raises a notice the user already waved off. */
export function cacheKey(input: Pick<ChatBannerInput, 'override' | 'pinned'>): string {
  return JSON.stringify({
    provider: input.override?.provider ?? null,
    model: input.override?.model ?? null,
    pinnedProvider: input.pinned?.provider ?? null,
    pinnedModel: input.pinned?.model ?? null,
  });
}

export interface ChatBannerInput {
  /** The in-chat model override the user staged (undefined ⇒ no pending change). */
  override?: ModelSelection | undefined;
  /** What the session last ran on (its pin) + when it last ran (for staleness). */
  pinned?: { provider?: string; model?: string; updatedAt?: string } | undefined;
  /** The config the RUNNING prompt was compiled from (session.promptConfig). */
  frozenConfig?: PromptConfigView | undefined;
  /** The config a send would use now (the agent's role + package selection). */
  agentConfig: PromptConfigView;
  /** The config key the user dismissed the drift banner for (suppresses re-show). */
  dismissedDriftKey?: string | undefined;
  /** The `cacheKey` the user dismissed the cache notice for (suppresses re-show). */
  dismissedCacheKey?: string | undefined;
  /** Whether the active session has ever produced a turn. A session that has never run
   *  has no warm prompt cache that could have gone cold, so the idle-staleness reason is
   *  gated on this. The model-changed reason below is a DIFFERENT reason in the same
   *  notice and is not gated by it — a staged model change on a fresh session is still
   *  honestly a cold-cache prediction. */
  hasRun: boolean;
  /** Now, ISO (injected for testability). */
  now: string;
}

/** The notices to dock inside the composer for the active session, ACTIONABLE FIRST:
 *  drift asks for a decision, cache only reports one. Empty ⇒ nothing to surface. */
export function computeChatBanners(input: ChatBannerInput): ChatNotice[] {
  const drift: ChatNotice[] = [];
  const cache: ChatNotice[] = [];

  // Cache: a staged model/provider that differs from the pin, or an idle session.
  const reasons: string[] = [];
  const pinnedProvider = input.pinned?.provider;
  if (input.override !== undefined) {
    if (input.override.provider !== undefined && input.override.provider !== pinnedProvider) {
      reasons.push('the backend changed');
    } else if (input.override.model !== undefined && input.override.model !== input.pinned?.model) {
      reasons.push('the model changed');
    }
  }
  const ttl = pinnedProvider !== undefined ? STALENESS_MS[pinnedProvider] : undefined;
  if (input.hasRun && ttl !== undefined && input.pinned?.updatedAt !== undefined) {
    const elapsed = Date.parse(input.now) - Date.parse(input.pinned.updatedAt);
    if (Number.isFinite(elapsed) && elapsed > ttl) reasons.push('the session has been idle');
  }
  if (reasons.length > 0 && input.dismissedCacheKey !== cacheKey(input)) {
    cache.push(cacheBanner(reasons));
  }

  // Drift: the running prompt's config differs from what a send would use.
  if (input.frozenConfig !== undefined) {
    const currentKey = configKey(input.agentConfig);
    if (configKey(input.frozenConfig) !== currentKey && input.dismissedDriftKey !== currentKey) {
      drift.push(DRIFT_BANNER);
    }
  }

  return [...drift, ...cache];
}

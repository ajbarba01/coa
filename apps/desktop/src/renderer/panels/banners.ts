import type { Banner, ModelSelection } from '@coa/console-viewmodel';

/**
 * Predictive chat banners — computed live in the console from what a send WOULD do,
 * not emitted by the daemon after the fact. Two derived, side-effect-free notices:
 *
 *  - **cache** (informational): the pending model/provider differs from what the
 *    session last ran on (a cold prompt cache), or the session has sat idle past its
 *    provider's cache TTL. It carries no action — it clears when the pending selection
 *    matches the pinned one again (a send, or reverting the pick).
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

const DRIFT_BANNER: Banner = {
  id: 'drift',
  kind: 'drift',
  reason:
    'The agent configuration changed while a compiled prompt is running. The active ' +
    'prompt still reflects the earlier configuration — recompile to apply the change, ' +
    'or dismiss to keep the current prompt.',
  actions: [{ id: 'recompile', label: 'Recompile', primary: true }],
};

function cacheBanner(reasons: readonly string[]): Banner {
  return {
    id: 'cache',
    kind: 'cache',
    reason: `The next message will start with a cold prompt cache (${reasons.join(
      ', ',
    )}), so it may be slower and cost more.`,
  };
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
  /** Now, ISO (injected for testability). */
  now: string;
}

/** The banners to show above the transcript for the active session — cache first
 *  (informational), then drift (actionable). Empty ⇒ nothing to surface. */
export function computeChatBanners(input: ChatBannerInput): Banner[] {
  const banners: Banner[] = [];

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
  if (ttl !== undefined && input.pinned?.updatedAt !== undefined) {
    const elapsed = Date.parse(input.now) - Date.parse(input.pinned.updatedAt);
    if (Number.isFinite(elapsed) && elapsed > ttl) reasons.push('the session has been idle');
  }
  if (reasons.length > 0) banners.push(cacheBanner(reasons));

  // Drift: the running prompt's config differs from what a send would use.
  if (input.frozenConfig !== undefined) {
    const currentKey = configKey(input.agentConfig);
    if (configKey(input.frozenConfig) !== currentKey && input.dismissedDriftKey !== currentKey) {
      banners.push(DRIFT_BANNER);
    }
  }

  return banners;
}

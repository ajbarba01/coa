import { RingMeter, Tooltip, cx } from '@coa/console-kit';
import type { ModelMetadata, SessionUsage } from '@coa/console-viewmodel';
import {
  contextRingState,
  formatTokenCount,
  formatTokenLimit,
  type ContextRingVm,
} from '@coa/console-viewmodel';

/**
 * The composer shelf's context gauge: how full the active model's window is,
 * always visible at glyph size, exact numbers on hover. All math lives in the
 * viewmodel (`contextRingState`); this component only pairs the kit's RingMeter
 * with the tooltip that carries the reading. Numbers wear `≈` throughout — the
 * settled figure is the adapters' own report, the draft figure an estimate, and
 * neither is a tokenizer.
 */

/** Pure: the hover line for a ring state. Exported for direct testing. */
export function ringTooltip(vm: ContextRingVm): string {
  const draft = vm.draftTokens > 0 ? ` · draft ≈ ${formatTokenCount(vm.draftTokens)}` : '';
  if (vm.kind === 'no-window') {
    const used =
      vm.usedTokens !== undefined
        ? ` (≈ ${formatTokenCount(vm.usedTokens)} tokens used${draft})`
        : draft === ''
          ? ''
          : ` (${draft.slice(3)})`;
    return `Context window unknown for this model${used}`;
  }
  const head = `Context ≈ ${formatTokenCount(vm.usedTokens + vm.draftTokens)} of ${formatTokenLimit(vm.contextWindow)} tokens (${vm.percent}%)`;
  const breakdown = vm.measured
    ? ` · last turn ${formatTokenCount(vm.usedTokens)}${draft}`
    : ` · no turn measured yet${draft}`;
  return head + breakdown;
}

export interface ContextRingProps {
  /** The last settled turn's usage (the daemon's `usage` push); absent ⇒ unmeasured. */
  usage?: SessionUsage | undefined;
  /** Live estimate for the drafted message (≈ chars/4). */
  draftTokens: number;
  /** The active model's catalog row; its `contextWindow` is the denominator. */
  metadata?: ModelMetadata | undefined;
  disabled?: boolean;
}

export function ContextRing({
  usage,
  draftTokens,
  metadata,
  disabled = false,
}: ContextRingProps): React.JSX.Element {
  const vm = contextRingState({
    usage,
    draftTokens,
    contextWindow: metadata?.contextWindow,
  });
  const label = ringTooltip(vm);
  return (
    <Tooltip label={label} side="top">
      {/* A focusable wrapper, mirroring the queued-pin pattern: the reading must be
          reachable by keyboard, and the svg itself dispatches no focus. */}
      <span
        tabIndex={0}
        className={cx(
          'flex h-7 items-center rounded-r2 px-1 focus-visible:outline-focus',
          disabled && 'opacity-70',
        )}
        data-context-ring
      >
        {vm.kind === 'no-window' ? (
          <RingMeter aria-label={label} />
        ) : (
          <RingMeter percent={vm.percent} tone={vm.tone} aria-label={label} />
        )}
      </span>
    </Tooltip>
  );
}

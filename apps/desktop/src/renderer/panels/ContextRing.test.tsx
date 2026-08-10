// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@coa/console-kit';
import type { ModelMetadata } from '@coa/console-viewmodel';
import { contextRingState } from '@coa/console-viewmodel';
import { ContextRing, ringTooltip } from './ContextRing.js';

const MODEL: ModelMetadata = { id: 'm', provider: 'claude', contextWindow: 200_000 };

function mount(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('ringTooltip', () => {
  it('reads the measured state: total of window, percent, last-turn figure, draft', () => {
    const vm = contextRingState({
      usage: { tokensIn: 40_000, tokensOut: 1_000, cacheReadTokens: 230 },
      draftTokens: 120,
      contextWindow: 200_000,
    });
    expect(ringTooltip(vm)).toBe(
      'Context ≈ 41,350 of 200k tokens (21%) · last turn 41,230 · draft ≈ 120',
    );
  });

  it('says so when nothing has been measured yet', () => {
    const vm = contextRingState({ draftTokens: 0, contextWindow: 200_000 });
    expect(ringTooltip(vm)).toBe('Context ≈ 0 of 200k tokens (0%) · no turn measured yet');
  });

  it('reports an unknown window honestly, still carrying what WAS measured', () => {
    const vm = contextRingState({ usage: { tokensIn: 600, tokensOut: 100 } });
    expect(ringTooltip(vm)).toBe('Context window unknown for this model (≈ 700 tokens used)');
    expect(ringTooltip(contextRingState({}))).toBe('Context window unknown for this model');
  });
});

describe('ContextRing', () => {
  it('renders a real meter sized by usage against the model window', () => {
    mount(
      <ContextRing
        usage={{ tokensIn: 40_000, tokensOut: 2_000 }}
        draftTokens={0}
        metadata={MODEL}
      />,
    );
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '21');
  });

  it('a bigger draft grows the fill (the live-typing estimate rides the ring)', () => {
    mount(
      <ContextRing
        usage={{ tokensIn: 40_000, tokensOut: 2_000 }}
        draftTokens={20_000}
        metadata={MODEL}
      />,
    );
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '31');
  });

  it('a model with no known window renders the honest unknown (no meter, dashed img)', () => {
    mount(<ContextRing usage={{ tokensIn: 10, tokensOut: 5 }} draftTokens={0} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /context window unknown for this model/i }),
    ).toBeInTheDocument();
  });

  it('a critical fill wears the crit stroke (the risk ramp is visible, not just numeric)', () => {
    const { container } = mount(
      <ContextRing
        usage={{ tokensIn: 185_000, tokensOut: 5_000 }}
        draftTokens={0}
        metadata={MODEL}
      />,
    );
    expect(container.querySelector('circle:nth-of-type(2)')?.getAttribute('class')).toContain(
      'text-crit',
    );
  });
});

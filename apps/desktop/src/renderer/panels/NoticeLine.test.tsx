// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatNotice } from './banners.js';
import { NoticeLine } from './NoticeLine.js';

const DRIFT: ChatNotice = {
  id: 'drift',
  kind: 'drift',
  summary: 'The agent configuration changed after this prompt compiled.',
  reason:
    'The agent configuration changed while a compiled prompt is running, so the active ' +
    'prompt still reflects the earlier configuration.',
  actions: [{ id: 'recompile', label: 'Recompile', primary: true }],
};

const CACHE: ChatNotice = {
  id: 'cache',
  kind: 'cache',
  summary: 'The model changed.',
  reason: 'The next message will start with a cold prompt cache, so it may be slower.',
};

describe('NoticeLine', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<NoticeLine notices={[]} onAction={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the cause without hovering — a warning carrying an action must state it', () => {
    render(<NoticeLine notices={[DRIFT]} onAction={() => {}} />);
    expect(
      screen.getByText('The agent configuration changed after this prompt compiled.'),
    ).toBeInTheDocument();
  });

  it('keeps the full reason as proximity detail, never permanent prose', () => {
    render(<NoticeLine notices={[DRIFT]} onAction={() => {}} />);
    // Base UI's Tooltip portals its content only once opened (hover/focus). The SUMMARY
    // is the visible clause; a regression that promoted the whole paragraph back into the
    // render (the old always-on banner) must fail here before anyone hovers.
    expect(screen.queryByText(DRIFT.reason)).not.toBeInTheDocument();
  });

  it('names the notice and offers its action inline', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<NoticeLine notices={[DRIFT]} onAction={onAction} />);
    expect(screen.getByText('Configuration drift')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recompile' }));
    expect(onAction).toHaveBeenCalledWith('drift', 'recompile');
  });

  it('offers dismiss on the passive cache notice, which has no other control', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<NoticeLine notices={[CACHE]} onAction={onAction} />);
    expect(screen.queryByRole('button', { name: 'Recompile' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onAction).toHaveBeenCalledWith('cache', 'dismiss');
  });

  it('tints the actionable notice a step louder than the passive one', () => {
    const { container } = render(<NoticeLine notices={[DRIFT, CACHE]} onAction={() => {}} />);
    const drift = container.querySelector('[data-notice-kind="drift"]');
    const cache = container.querySelector('[data-notice-kind="cache"]');
    expect(drift?.className).toContain('bg-warn/7');
    expect(cache?.className).toContain('bg-warn/4');
  });
});

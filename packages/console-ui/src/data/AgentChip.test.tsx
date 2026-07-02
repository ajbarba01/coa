// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AGENT_COLOR_NAMES, AGENT_ICON_NAMES, AgentChip } from './AgentChip.js';

describe('AgentChip', () => {
  it('is decorative by default', () => {
    const { container } = render(<AgentChip icon="wrench" color="teal" />);
    const chip = container.querySelector('[data-color="teal"]');
    expect(chip).toHaveAttribute('aria-hidden', 'true');
  });

  it('is announced as an image when labelled', () => {
    render(<AgentChip icon="search" color="sky" label="reviewer" />);
    expect(screen.getByRole('img', { name: 'reviewer' })).toBeInTheDocument();
  });

  it('offers the full curated vocabulary and no brass', () => {
    expect(AGENT_ICON_NAMES).toHaveLength(16);
    expect(AGENT_COLOR_NAMES).toHaveLength(8);
    expect(AGENT_COLOR_NAMES).not.toContain('brass');
  });

  it('renders every color without throwing', () => {
    for (const color of AGENT_COLOR_NAMES) {
      const { unmount } = render(<AgentChip icon="bot" color={color} label={color} />);
      expect(screen.getByRole('img', { name: color })).toHaveAttribute('data-color', color);
      unmount();
    }
  });
});

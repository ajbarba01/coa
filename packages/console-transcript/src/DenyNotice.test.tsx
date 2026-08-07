// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DenyNotice } from './DenyNotice.js';

describe('DenyNotice', () => {
  it('surfaces a close-gate denial as a status region with the reason, verbatim', () => {
    render(
      <DenyNotice
        kind="close-gate"
        reason="Change blocked at close"
        detail="Resolve or baseline the open flags to continue."
      />,
    );
    // The one block in the system — a firm stop, not an alarm.
    // role="status" (not "alert") reads as an informational, non-modal notice.
    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('data-deny-kind', 'close-gate');
    expect(screen.getByText('Change blocked at close')).toBeInTheDocument();
    expect(screen.getByText('Resolve or baseline the open flags to continue.')).toBeInTheDocument();
  });

  it('renders the caps label and the two ways-forward', () => {
    render(<DenyNotice kind="close-gate" reason="flags unresolved" />);
    expect(screen.getByText(/close gate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review the flags/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see the record/i })).toBeInTheDocument();
  });

  it('carries exactly one critical dot — the only red in the notice', () => {
    const { container } = render(<DenyNotice kind="close-gate" reason="flags unresolved" />);
    const critical = container.querySelectorAll('.bg-crit');
    expect(critical).toHaveLength(1);
  });

  it('renders the daemon reason verbatim, unaltered', () => {
    const reason = 'Close blocked: 2 Type-1 flags are open. Resolve or baseline them first.';
    render(<DenyNotice kind="close-gate" reason={reason} />);
    expect(screen.getByText(reason)).toBeInTheDocument();
  });
});

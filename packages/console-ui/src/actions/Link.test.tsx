// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Link } from './Link.js';

describe('Link', () => {
  it('renders an anchor with the tone data flag', () => {
    render(
      <Link href="/x" tone="muted">
        docs
      </Link>,
    );
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('data-tone', 'muted');
  });
  it('hardens external links with rel + target and marks them', () => {
    render(
      <Link href="https://x.test" external>
        out
      </Link>,
    );
    const a = screen.getByRole('link', { name: /out/ });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

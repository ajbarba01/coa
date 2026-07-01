// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders a toned label', () => {
    render(<Badge tone="danger">crit</Badge>);
    expect(screen.getByText('crit')).toHaveAttribute('data-tone', 'danger');
  });
});

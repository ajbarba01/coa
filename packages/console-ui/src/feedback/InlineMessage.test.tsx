// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineMessage } from './InlineMessage.js';

describe('InlineMessage', () => {
  it('renders toned inline text', () => {
    render(<InlineMessage tone="warning">Unsaved changes</InlineMessage>);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByTestId('inline-message')).toHaveAttribute('data-tone', 'warning');
  });
});

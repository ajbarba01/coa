// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KeyValue } from './KeyValue.js';

describe('KeyValue', () => {
  it('renders term/description pairs', () => {
    render(
      <KeyValue
        pairs={[
          { key: 'Model', value: 'opus' },
          { key: 'Turns', value: '12' },
        ]}
      />,
    );
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('opus')).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { List } from './List.js';

describe('List', () => {
  it('renders each item and labels the list', () => {
    render(
      <List
        label="Flags"
        items={['a', 'b']}
        getKey={(x) => x}
        renderItem={(x) => <span>{x.toUpperCase()}</span>}
      />,
    );
    const list = screen.getByRole('list', { name: 'Flags' });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});

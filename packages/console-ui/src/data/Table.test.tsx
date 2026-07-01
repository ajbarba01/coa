// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Table, type Column } from './Table.js';

interface Row {
  id: string;
  verb: string;
  cost: number;
}
const columns: Column<Row>[] = [
  { key: 'verb', header: 'Verb' },
  { key: 'cost', header: 'Cost', align: 'end', render: (r) => `$${r.cost.toFixed(2)}` },
];

describe('Table', () => {
  it('renders headers and rendered cells', () => {
    render(
      <Table
        caption="Ledger"
        columns={columns}
        rows={[{ id: '1', verb: 'emit', cost: 2 }]}
        getRowId={(r) => r.id}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Verb' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '$2.00' })).toBeInTheDocument();
  });
  it('shows the empty slot when there are no rows (states-first)', () => {
    render(
      <Table
        caption="Ledger"
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        empty={<span>No entries yet</span>}
      />,
    );
    expect(screen.getByText('No entries yet')).toBeInTheDocument();
    expect(screen.queryByRole('row')).toBeNull();
  });
});

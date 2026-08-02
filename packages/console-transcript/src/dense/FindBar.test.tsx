// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FindBar } from './FindBar.js';

describe('FindBar', () => {
  it('renders the query input and a 0/0 count for a query with no matches', () => {
    render(
      <FindBar
        query="zz"
        onQueryChange={vi.fn()}
        current={0}
        total={0}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: /find/i })).toBeInTheDocument();
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });

  it('reports typed input via onQueryChange', async () => {
    const onQueryChange = vi.fn();
    render(
      <FindBar
        query=""
        onQueryChange={onQueryChange}
        current={0}
        total={0}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /find/i }), 'hi');
    expect(onQueryChange).toHaveBeenCalled();
  });

  it('shows the current/total match count', () => {
    render(
      <FindBar
        query="hello"
        onQueryChange={vi.fn()}
        current={2}
        total={5}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('2/5')).toBeInTheDocument();
  });

  it('offers prev/next/close controls', () => {
    render(
      <FindBar
        query="hello"
        onQueryChange={vi.fn()}
        current={1}
        total={2}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /previous match/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next match/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close find/i })).toBeInTheDocument();
  });

  it('disables prev/next when there are no matches', () => {
    render(
      <FindBar
        query="zz"
        onQueryChange={vi.fn()}
        current={0}
        total={0}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /previous match/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next match/i })).toBeDisabled();
  });

  it('calls onNext/onPrev when the chevrons are clicked', async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(
      <FindBar
        query="hello"
        onQueryChange={vi.fn()}
        current={1}
        total={2}
        onPrev={onPrev}
        onNext={onNext}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /next match/i }));
    await userEvent.click(screen.getByRole('button', { name: /previous match/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked or Escape is pressed', async () => {
    const onClose = vi.fn();
    render(
      <FindBar
        query=""
        onQueryChange={vi.fn()}
        current={0}
        total={0}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /close find/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByRole('textbox', { name: /find/i }), '{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

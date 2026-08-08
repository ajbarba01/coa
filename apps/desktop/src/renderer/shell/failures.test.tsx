// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FailureToast } from './FailureToast.js';
import { reportFailure, reportNotice, surfaceWrite, useNotices } from './failures.js';

beforeEach(() => {
  useNotices.setState({ notice: undefined });
});

describe('surfaceWrite', () => {
  it('leaves a write that lands completely alone', async () => {
    await expect(surfaceWrite('save that login', Promise.resolve('saved'))).resolves.toBe('saved');
    expect(useNotices.getState().notice).toBeUndefined();
  });

  it('announces a rejected write instead of swallowing it, and never rejects itself', async () => {
    const result = await surfaceWrite('save that login', Promise.reject(new Error('disk is full')));
    expect(result).toBeUndefined();
    expect(useNotices.getState().notice).toMatchObject({
      title: "Couldn't save that login",
      detail: 'disk is full',
      tone: 'danger',
    });
  });

  it('carries a non-Error rejection through rather than reporting nothing', async () => {
    await surfaceWrite('remove that model', Promise.reject('refused'));
    expect(useNotices.getState().notice?.detail).toBe('refused');
  });
});

describe('the failure surface', () => {
  it('re-announces the same message rather than sitting on a stale one', () => {
    reportFailure('save that login', new Error('disk is full'));
    const first = useNotices.getState().notice?.key;
    reportFailure('save that login', new Error('disk is full'));
    expect(useNotices.getState().notice?.key).not.toBe(first);
  });

  it('shows the newest notice — the user is asking about what they just did', () => {
    reportFailure('save that login', new Error('disk is full'));
    reportNotice('Nothing to recompile');
    expect(useNotices.getState().notice).toMatchObject({
      title: 'Nothing to recompile',
      tone: 'info',
    });
  });
});

describe('FailureToast', () => {
  it('renders nothing at all until something fails', () => {
    const { container } = render(<FailureToast />);
    expect(container.firstChild).toBeNull();
  });

  it('states what failed and why, and dismisses without taking focus', () => {
    render(<FailureToast />);
    act(() => reportFailure('save that login', new Error('disk is full')));
    expect(screen.getByText("Couldn't save that login")).toBeTruthy();
    expect(screen.getByText('disk is full')).toBeTruthy();
    // Advisory, not a gate: it announces politely and blocks nothing.
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');

    act(() => screen.getByRole('button', { name: 'Dismiss' }).click());
    expect(useNotices.getState().notice).toBeUndefined();
  });
});

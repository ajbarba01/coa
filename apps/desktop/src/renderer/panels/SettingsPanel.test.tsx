// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { settingsPanel, selectSettingsVm } from './SettingsPanel.js';
import type { ConsoleState } from './state.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';

const SettingsView = settingsPanel.render;
const host = {
  title: 'Settings',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

const state = (setSettings = vi.fn()): ConsoleState => ({
  data: {
    cap: { status: 'loading' },
    flags: { status: 'loading' },
    timeline: { status: 'loading' },
    accounts: { status: 'loading' },
  },
  ui: { activeMainPanelId: 'settings', settings: DEFAULT_SETTINGS },
  actions: { setRoute: () => {}, refresh: () => {}, switchAccount: () => {}, setSettings },
});

describe('SettingsView', () => {
  it('renders the theme, density, and motion controls', () => {
    render(<SettingsView vm={selectSettingsVm(state())} host={host} />);
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Density')).toBeTruthy();
    expect(screen.getByText(/reduce motion/i)).toBeTruthy();
  });
});

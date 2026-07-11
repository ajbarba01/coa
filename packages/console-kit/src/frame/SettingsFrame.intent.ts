import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const dialogSearchHeadIntent: ComponentIntent = assertIntent({
  name: 'DialogSearchHead',
  family: 'Layout',
  intent:
    'The dialog head where search owns the top row — typing filters the body live, VS Code style.',
  useWhen: ['The head of any settings-shaped dialog whose rows are searchable.'],
  dontUseWhen: [
    'A dialog with no filterable body — a plain caps header row.',
    'App-wide search — that is the session browser, not a dialog head.',
  ],
  anatomy: 'Glyph + autofocused borderless input + ghost close Button over the s3 head hairline.',
  variantsStates: ['empty (placeholder)', 'filtering (value drives the caller)'],
  accessibility:
    'The input opts out of the focus ring per the law (its container border is the cue); close is a labelled ghost Button.',
  related: ['ModalShell', 'TocRail', 'SettingRow'],
});

export const tocRailIntent: ComponentIntent = assertIntent({
  name: 'TocRail',
  family: 'Layout',
  intent: 'The dialog TOC rail: one row per section, jump on click, quiet active tint.',
  useWhen: ['Sectioned dialog bodies that deserve a jump list (settings).'],
  dontUseWhen: [
    'App navigation — that is the left nav, not a dialog rail.',
    'Search mode — pass activeId null so nothing claims the tint.',
  ],
  anatomy: 'A fixed-width column of full-width rows against the s3 rail hairline.',
  variantsStates: [
    'default',
    'hover',
    'active (s3 tint + s12 ink)',
    'activeId null (search — no tint)',
  ],
  accessibility:
    'Native buttons; the active row is also the scrolled-to section for sighted parity.',
  related: ['DialogSearchHead', 'SettingRow'],
});

export const settingRowIntent: ComponentIntent = assertIntent({
  name: 'SettingRow',
  family: 'Layout',
  intent: 'One setting: name + one-line description + a trailing inline control.',
  useWhen: [
    'Every row of a settings-shaped dialog — controls slot in as children (Toggle, Select, Kbd chips).',
  ],
  dontUseWhen: ['Menu options — MenuItem.', 'Rows without a control — plain text needs no frame.'],
  anatomy: 'Flex row: name (sec scale) over description (quiet s7), control pinned right.',
  variantsStates: ['default (state lives in the slotted control)'],
  accessibility:
    'The slotted control carries the interactive semantics; name/description sit adjacent for context.',
  related: ['Toggle', 'Select', 'Kbd', 'TocRail'],
});

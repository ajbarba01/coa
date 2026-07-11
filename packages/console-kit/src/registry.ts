import { buttonIntent } from './actions/Button.intent.js';
import { panelResizeIntent } from './layout/PanelResize.intent.js';
import type { ComponentIntent } from './lib/intent.js';
import { statusDotIntent } from './StatusDot.intent.js';
import { useClickAwayIntent, useDismissLayerIntent } from './overlay/layers.intent.js';
import { capsLabelIntent, menuCardIntent, menuItemIntent } from './overlay/MenuCard.intent.js';
import { modalShellIntent } from './overlay/ModalShell.intent.js';
import { popoverCardIntent } from './overlay/PopoverCard.intent.js';
import {
  dialogSearchHeadIntent,
  settingRowIntent,
  tocRailIntent,
} from './frame/SettingsFrame.intent.js';
import { kbdIntent } from './keys/Kbd.intent.js';
import { shortcutsOverlayIntent } from './keys/ShortcutsOverlay.intent.js';
import { selectIntent } from './inputs/Select.intent.js';
import { stepSliderIntent } from './inputs/StepSlider.intent.js';
import { toggleIntent } from './inputs/Toggle.intent.js';

/** Every kit member appends its intent here. Feeds COMPONENTS.md + the coverage test. */
export const allIntents: ComponentIntent[] = [
  statusDotIntent,
  useDismissLayerIntent,
  useClickAwayIntent,
  buttonIntent,
  menuCardIntent,
  menuItemIntent,
  capsLabelIntent,
  popoverCardIntent,
  selectIntent,
  toggleIntent,
  stepSliderIntent,
  panelResizeIntent,
  modalShellIntent,
  kbdIntent,
  shortcutsOverlayIntent,
  dialogSearchHeadIntent,
  tocRailIntent,
  settingRowIntent,
];

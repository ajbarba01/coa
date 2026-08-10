import { buttonIntent } from './actions/Button.intent.js';
import { brandMarkIntent } from './brand/BrandMark.intent.js';
import { windowControlsIntent } from './chrome/WindowControls.intent.js';
import { iconIntent } from './data/Icon.intent.js';
import { inlineMessageIntent } from './feedback/InlineMessage.intent.js';
import { toastIntent } from './feedback/Toast.intent.js';
import { meterIntent } from './data/Meter.intent.js';
import { ringMeterIntent } from './data/RingMeter.intent.js';
import { panelResizeIntent } from './layout/PanelResize.intent.js';
import type { ComponentIntent } from './lib/intent.js';
import { spinnerIntent } from './Spinner.intent.js';
import { statusDotIntent } from './StatusDot.intent.js';
import { useClickAwayIntent, useDismissLayerIntent } from './overlay/layers.intent.js';
import { capsLabelIntent, menuCardIntent, menuItemIntent } from './overlay/MenuCard.intent.js';
import { modalShellIntent } from './overlay/ModalShell.intent.js';
import { paneOverlayIntent } from './overlay/PaneOverlay.intent.js';
import { popoverCardIntent } from './overlay/PopoverCard.intent.js';
import { tooltipIntent } from './overlay/Tooltip.intent.js';
import {
  dialogSearchHeadIntent,
  settingRowIntent,
  tocRailIntent,
} from './frame/SettingsFrame.intent.js';
import { kbdIntent } from './keys/Kbd.intent.js';
import { shortcutsOverlayIntent } from './keys/ShortcutsOverlay.intent.js';
import { comboboxIntent } from './inputs/Combobox.intent.js';
import { selectIntent } from './inputs/Select.intent.js';
import { stepSliderIntent } from './inputs/StepSlider.intent.js';
import { toggleIntent } from './inputs/Toggle.intent.js';
import { zoomIntent } from './zoom.intent.js';

/** Every kit member appends its intent here. Feeds COMPONENTS.md + the coverage test. */
export const allIntents: ComponentIntent[] = [
  statusDotIntent,
  spinnerIntent,
  brandMarkIntent,
  meterIntent,
  ringMeterIntent,
  iconIntent,
  inlineMessageIntent,
  toastIntent,
  useDismissLayerIntent,
  useClickAwayIntent,
  zoomIntent,
  buttonIntent,
  windowControlsIntent,
  menuCardIntent,
  menuItemIntent,
  capsLabelIntent,
  paneOverlayIntent,
  popoverCardIntent,
  tooltipIntent,
  selectIntent,
  comboboxIntent,
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

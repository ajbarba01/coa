import type { ComponentIntent } from './lib/intent.js';
import { iconIntent } from './icon/Icon.intent.js';
import { buttonIntent } from './actions/Button.intent.js';
import { iconButtonIntent } from './actions/IconButton.intent.js';
import { buttonGroupIntent } from './actions/ButtonGroup.intent.js';
import { linkIntent } from './actions/Link.intent.js';
import { menuIntent } from './actions/Menu.intent.js';
import { fieldIntent } from './inputs/Field.intent.js';
import { textFieldIntent } from './inputs/TextField.intent.js';
import { checkboxIntent } from './inputs/Checkbox.intent.js';
import { radioIntent } from './inputs/Radio.intent.js';
import { switchIntent } from './inputs/Switch.intent.js';
import { selectIntent } from './inputs/Select.intent.js';
import { comboboxIntent } from './inputs/Combobox.intent.js';
import { bannerIntent } from './feedback/Banner.intent.js';
import { denyNoticeIntent } from './feedback/DenyNotice.intent.js';
import { toastIntent } from './feedback/Toast.intent.js';
import { inlineMessageIntent } from './feedback/InlineMessage.intent.js';
import { progressIntent } from './feedback/Progress.intent.js';
import { spinnerIntent } from './feedback/Spinner.intent.js';
import { skeletonIntent } from './feedback/Skeleton.intent.js';
import { emptyStateIntent } from './feedback/EmptyState.intent.js';
import { dialogIntent } from './overlays/Dialog.intent.js';
import { popoverIntent } from './overlays/Popover.intent.js';
import { tooltipIntent } from './overlays/Tooltip.intent.js';
import { sheetIntent } from './overlays/Sheet.intent.js';

/** Every component appends its intent here. Feeds COMPONENTS.md + the coverage test. */
export const allIntents: ComponentIntent[] = [
  iconIntent,
  buttonIntent,
  iconButtonIntent,
  buttonGroupIntent,
  linkIntent,
  menuIntent,
  fieldIntent,
  textFieldIntent,
  checkboxIntent,
  radioIntent,
  switchIntent,
  selectIntent,
  comboboxIntent,
  bannerIntent,
  denyNoticeIntent,
  toastIntent,
  inlineMessageIntent,
  progressIntent,
  spinnerIntent,
  skeletonIntent,
  emptyStateIntent,
  dialogIntent,
  popoverIntent,
  tooltipIntent,
  sheetIntent,
];

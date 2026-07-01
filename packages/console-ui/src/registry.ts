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
];

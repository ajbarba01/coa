import { buttonIntent } from './actions/Button.intent.js';
import type { ComponentIntent } from './lib/intent.js';
import { statusDotIntent } from './StatusDot.intent.js';
import { useClickAwayIntent, useDismissLayerIntent } from './overlay/layers.intent.js';
import { capsLabelIntent, menuCardIntent, menuItemIntent } from './overlay/MenuCard.intent.js';
import { popoverCardIntent } from './overlay/PopoverCard.intent.js';

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
];

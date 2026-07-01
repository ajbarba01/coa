import type { ComponentIntent } from './lib/intent.js';
import { iconIntent } from './icon/Icon.intent.js';

/** Every component appends its intent here. Feeds COMPONENTS.md + the coverage test. */
export const allIntents: ComponentIntent[] = [iconIntent];

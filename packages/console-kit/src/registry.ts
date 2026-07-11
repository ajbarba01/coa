import type { ComponentIntent } from './lib/intent.js';
import { statusDotIntent } from './StatusDot.intent.js';

/** Every kit member appends its intent here. Feeds COMPONENTS.md + the coverage test. */
export const allIntents: ComponentIntent[] = [statusDotIntent];

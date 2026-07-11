import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allIntents } from '../src/registry.js';
import { generateCatalog } from '../src/lib/catalog.js';

const out = fileURLToPath(new URL('../COMPONENTS.md', import.meta.url));
writeFileSync(out, generateCatalog(allIntents), 'utf8');
process.stdout.write(`wrote ${allIntents.length} components to COMPONENTS.md\n`);

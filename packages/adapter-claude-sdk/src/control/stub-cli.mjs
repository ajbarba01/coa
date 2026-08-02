#!/usr/bin/env node
/* global process -- a standalone node script; the repo's eslint config supplies no node globals to .mjs */
// A fake `claude` binary for the control spike. It records the argv and env the
// Agent SDK constructed, then exits. It deliberately does NOT speak stream-json:
// argv is written before any protocol exchange, so the capture is complete even
// though the SDK's query() then fails. Never spawned by product code.
import { writeFileSync } from 'node:fs';

const out = process.env['COA_PROBE_CAPTURE'];
if (out === undefined || out === '') {
  process.stderr.write('stub-cli: COA_PROBE_CAPTURE is unset\n');
  process.exit(2);
}

writeFileSync(
  out,
  JSON.stringify({ argv: process.argv.slice(2), env: process.env }, null, 2),
  'utf8',
);
process.exit(0);

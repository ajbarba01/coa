// Launches `electron-vite dev` with ELECTRON_RUN_AS_NODE cleared. A launching shell (the
// VS Code integrated terminal, some task runners) can inject that variable; with it set,
// Electron boots as a plain Node process and no application window ever appears. Clearing
// it here means `pnpm --filter @coa/desktop dev` starts the GUI no matter where it is run.
import { spawn } from 'node:child_process';

delete process.env.ELECTRON_RUN_AS_NODE;

// `shell: true` resolves the `electron-vite` bin from the pnpm-augmented PATH on both
// Windows (.cmd) and POSIX; stdio is inherited so the dev server logs stream through.
const child = spawn('electron-vite dev', { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));

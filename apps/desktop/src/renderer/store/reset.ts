import { resetDaemonData } from './data.js';
import { resetSessions } from './sessions.js';
import { resetTranscripts } from './transcripts.js';
import { resetProjectUi } from './ui.js';

/**
 * Forget the project this window is leaving.
 *
 * The slices are module singletons, so they OUTLIVE the console controller a project
 * swap tears down and reboots — without this the new project would open holding the old
 * one's sessions, transcripts, run claims and per-session notices, and a session id from
 * one project names nothing in another. Runs on the swap boundary itself (the composition
 * root's controller-boot effect), before the fresh controller's first read lands, so the
 * new project starts from the same loading ground a brand new window does.
 *
 * What survives is what was never the project's: the console's own settings and the raw
 * toggle (see `resetProjectUi`).
 */
export function resetProjectState(): void {
  resetTranscripts();
  resetSessions();
  resetDaemonData();
  resetProjectUi();
}

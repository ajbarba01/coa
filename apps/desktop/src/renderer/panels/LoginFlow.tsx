import { Button, ModalShell, StatusDot, cx } from '@coa/console-kit';
import { useState } from 'react';
import { useMockLogin, type LoginFlow as Flow } from './mockLogin.js';
import type { ProviderDescriptor } from './providers.js';

/**
 * The in-app Claude LOGIN / RELOGIN flow — coa drives `claude auth login --claudeai` against a
 * managed dir (~/.coa/logins/<label>/, via CLAUDE_CONFIG_DIR), watches for the login to land,
 * and registers the account. coa never reads the token; it only watches the dir + polls
 * `claude auth status --json`, so credential-blindness holds.
 *
 * GATE-1 SPIKE (attended, real CLI): the command AUTO-OPENS the browser AND prints the OAuth
 * URL to stdout, with a "paste code if prompted" fallback. So the flow is a HYBRID — browser
 * (guided) is primary; coa shows the captured URL in-app as the "didn't open?" affordance; the
 * code field is the deeper fallback. MOCKUP: the phases step by hand; the real driver steps
 * them from the spawn, the stdout URL, the status poll, and the credentials landing.
 */

/** "Sign in with Claude" — the driven path, primary for a config-dir backend. Keeps the
 *  manual "point at an existing dir" path as the advanced fallback (strict-superset). */
export function SignInButton({
  provider,
  label,
}: {
  provider: ProviderDescriptor;
  label: string;
}): React.JSX.Element {
  const startLogin = useMockLogin((s) => s.startLogin);
  return (
    <Button
      variant="quiet"
      onClick={() => startLogin({ providerId: provider.id, mode: 'new', label })}
    >
      sign in with {provider.label}
    </Button>
  );
}

/** The relogin entry point, aimed at an existing login (from a row action or a badge). */
export function useStartRelogin(): (
  provider: ProviderDescriptor,
  label: string,
  credentialId: string,
) => void {
  const startLogin = useMockLogin((s) => s.startLogin);
  return (provider, label, credentialId) =>
    startLogin({ providerId: provider.id, mode: 'relogin', label, credentialId });
}

/** Mounted once on the shell frame: renders the active driven-login flow as a modal. */
export function LoginDialog(): React.JSX.Element | null {
  const flow = useMockLogin((s) => s.flow);
  const cancelLogin = useMockLogin((s) => s.cancelLogin);
  if (flow === undefined) return null;
  return (
    <ModalShell open onClose={cancelLogin} aria-label="sign in" className="w-120">
      <FlowBody flow={flow} />
    </ModalShell>
  );
}

function FlowBody({ flow }: { flow: Flow }): React.JSX.Element {
  const advance = useMockLogin((s) => s.advance);
  const failLogin = useMockLogin((s) => s.failLogin);
  const cancelLogin = useMockLogin((s) => s.cancelLogin);
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);

  const title =
    flow.mode === 'relogin' ? `re-login ${flow.label}` : `sign in — new ${flow.providerId} login`;

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
        <StatusDot status={dotFor(flow)} />
        <span className="text-sec font-semibold text-s11">{title}</span>
        <span className="ml-auto font-mono text-meta text-s7">{flow.phase}</span>
      </div>

      <div className="px-4 py-4">
        {flow.phase === 'launching' && (
          <Step
            heading="starting Claude sign-in"
            body={`coa is creating ~/.coa/logins/${flow.label}/ and running Claude's own login against it. It watches for the login to land — it never reads your token.`}
          />
        )}

        {flow.phase === 'awaiting' && (
          <div className="flex flex-col gap-3">
            <Step
              heading="finish signing in"
              body="Your browser opened to Claude's sign-in — finish there and come back. Claude handles the password and writes the login into the folder; coa is watching for it."
            />
            {/* The captured stdout URL, shown in-app: the "browser didn't open?" affordance —
                open it here, or scan/paste it on another device. */}
            <div className="flex flex-col gap-2 rounded-r3 border border-s5 bg-s1 px-3 py-3">
              <span className="font-mono text-meta text-s7">didn&apos;t open? use this link</span>
              <span className="font-mono text-code break-all text-s10">{flow.oauthUrl}</span>
            </div>
            {/* The deeper fallback: the CLI's "paste code here if prompted". Only surfaces on
                demand — the normal browser redirect completes without it. */}
            {showCode ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="paste the code from the browser…"
                  aria-label="authorization code"
                  className="slip min-w-0 flex-1 rounded-r2 border border-s5 bg-s1 px-2.5 py-1 font-mono text-code text-s11 outline-none placeholder:text-s7 focus:border-s7"
                />
                <Button variant="quiet" disabled={code.trim() === ''} onClick={advance}>
                  submit
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCode(true)}
                className="slip cursor-pointer text-left font-mono text-meta text-s6 hover:text-s9"
              >
                prompted for a code instead? enter it →
              </button>
            )}
          </div>
        )}

        {flow.phase === 'watching' && (
          <Step
            heading="watching for your login"
            body="Signed in — coa is polling `claude auth status` and watching the folder. The moment the login lands, this account registers itself."
          />
        )}

        {flow.phase === 'registered' && (
          <Step
            heading="you're in"
            body={`Added ${flow.label} — logged in as ${flow.identity}. coa stored a pointer to the folder, never the token.`}
          />
        )}

        {flow.phase === 'failed' && (
          <Step
            tone="crit"
            heading="sign-in didn't finish"
            body="No login landed in the folder. Nothing was changed. Try again, or point coa at an existing config dir from the add menu."
          />
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-s3 px-4 py-3">
        <div className="flex-1" />
        {flow.phase === 'registered' ? (
          <Button variant="quiet" onClick={cancelLogin}>
            done
          </Button>
        ) : flow.phase === 'failed' ? (
          <>
            <Button variant="outline" onClick={cancelLogin}>
              close
            </Button>
            <Button variant="quiet" onClick={advance}>
              try again
            </Button>
          </>
        ) : (
          <>
            {/* MOCKUP stepper — the real driver advances on the spawn / status-poll, not a click. */}
            <Button variant="text" onClick={failLogin}>
              simulate failure
            </Button>
            <Button variant="outline" onClick={cancelLogin}>
              cancel
            </Button>
            <Button variant="quiet" onClick={advance}>
              simulate next step
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function dotFor(flow: Flow): 'running' | 'needs-you' | 'done' | 'critical' {
  if (flow.phase === 'registered') return 'done';
  if (flow.phase === 'failed') return 'critical';
  if (flow.phase === 'awaiting') return 'needs-you';
  return 'running';
}

function Step({
  heading,
  body,
  tone,
}: {
  heading: string;
  body: string;
  tone?: 'crit';
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cx('text-body font-[550]', tone === 'crit' ? 'text-crit' : 'text-s12')}>
        {heading}
      </span>
      <span className="text-code leading-relaxed text-s9">{body}</span>
    </div>
  );
}

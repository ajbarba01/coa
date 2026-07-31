import { Button, ModalShell, StatusDot, cx } from '@coa/console-kit';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { LoginSnapshot } from '@coa/console-viewmodel';
import { useShell } from '../shell/store.js';
import { useLogin } from './loginStore.js';
import type { Credential } from './mockAuth.js';
import { RISE } from './motion.js';
import type { ProviderDescriptor } from './providers.js';

/**
 * The in-app Claude LOGIN / RELOGIN flow — coa drives `claude auth login --claudeai
 * --email <email>` against a managed dir (~/.coa/logins/<slug>/, via CLAUDE_CONFIG_DIR),
 * watches the CLI's output for the OAuth URL, polls `claude auth status --json` for the
 * login to land, and registers the account under its email. coa never reads the token —
 * credential-blindness holds (the ADR shipped with this feature).
 *
 * An account is DEFINED by its email here: the flow opens on an email-first pre-step
 * (renderer-local — the daemon only hears about a flow once the email is known), the
 * browser opens pre-filled with it, and the probe's landed email is the truth — a
 * mismatch is FLAGGED with keep/retry, never blocked (SC-1). Everything after the
 * pre-step is a projection of the daemon's `LoginSnapshot`; phases advance only from
 * polling, never from clicks.
 */

/** How often the open dialog re-reads `loginState` — the flow's only clock. */
const POLL_MS = 1000;

/** The one email shape check worth doing locally: something@something. Anything deeper
 *  is the browser's sign-in page's job — coa only pre-fills. */
const looksLikeEmail = (value: string): boolean => /\S+@\S+/.test(value.trim());

/** "Sign in with Claude" — the driven path, primary for a config-dir backend. The manual
 *  "point at an existing dir" path stays reachable from the provider menu (strict-superset). */
export function SignInButton({ provider }: { provider: ProviderDescriptor }): React.JSX.Element {
  const setLoginEmailFor = useShell((s) => s.setLoginEmailFor);
  return (
    <Button variant="quiet" onClick={() => setLoginEmailFor({ providerId: provider.id })}>
      sign in with {provider.label}
    </Button>
  );
}

/** The relogin entry point, aimed at an existing login (a row action or a badge). The
 *  email is already known on the credential (declared, or probe-seen inside `identity`),
 *  so the flow starts immediately — no pre-step. A legacy row with no email at all falls
 *  back to the pre-step, carrying its target so the relogin still heals it. */
export function useStartRelogin(): (credential: Credential) => void {
  const setLoginEmailFor = useShell((s) => s.setLoginEmailFor);
  return (credential) => {
    const email = credential.email ?? credential.identity?.split(' · ')[0];
    if (email !== undefined && looksLikeEmail(email)) {
      useShell.getState().setLoginEmailFor(undefined);
      void useLogin
        .getState()
        .startLogin({
          providerId: credential.providerId,
          mode: 'relogin',
          email,
          credentialId: credential.id,
        })
        .catch(() => {});
    } else {
      setLoginEmailFor({ providerId: credential.providerId, credentialId: credential.id });
    }
  };
}

/** Mounted once on the shell frame: the email pre-step (shell dialog slot) and the live
 *  driven flow (daemon state) share one modal — a badge's re-login renders from any surface. */
export function LoginDialog(): React.JSX.Element | null {
  const pre = useShell((s) => s.loginEmailFor);
  const setLoginEmailFor = useShell((s) => s.setLoginEmailFor);
  const flow = useLogin((s) => s.flow);

  // The flow's only clock: while the daemon owns a flow, re-read it every second. The
  // interval dies with the dialog (unmount or flow-end), so an idle app never polls.
  const polling = flow !== undefined;
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => void useLogin.getState().poll().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [polling]);

  if (flow === undefined && pre === undefined) return null;

  // Escape/backdrop is safe at every phase: a pre-step just closes; a live flow cancels —
  // the CLI is killed and nothing registers (the daemon clears to idle).
  const close = (): void => {
    if (flow !== undefined) void useLogin.getState().cancelLogin().catch(() => {});
    if (pre !== undefined) setLoginEmailFor(undefined);
  };

  return (
    <ModalShell open onClose={close} aria-label="sign in" className="w-120">
      {flow !== undefined ? (
        <FlowBody flow={flow} onClose={close} />
      ) : pre !== undefined ? (
        <EmailStep providerId={pre.providerId} credentialId={pre.credentialId} />
      ) : null}
    </ModalShell>
  );
}

/** The renderer-local pre-step: the flow is email-defined, so the email comes first. The
 *  daemon hears nothing until continue — cancelling here cancels nothing but a form. */
function EmailStep({
  providerId,
  credentialId,
}: {
  providerId: string;
  credentialId?: string | undefined;
}): React.JSX.Element {
  const setLoginEmailFor = useShell((s) => s.setLoginEmailFor);
  const [email, setEmail] = useState('');
  const valid = looksLikeEmail(email);

  const commit = (): void => {
    if (!valid) return;
    setLoginEmailFor(undefined);
    void useLogin
      .getState()
      .startLogin({
        providerId,
        mode: credentialId === undefined ? 'new' : 'relogin',
        email: email.trim(),
        ...(credentialId !== undefined ? { credentialId } : {}),
      })
      .catch(() => {});
  };

  return (
    <>
      <header className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
        <StatusDot status="needs-you" />
        <span className="text-sec font-semibold text-s11">sign in with {providerId}</span>
      </header>
      <div className="flex flex-col gap-3 px-4 py-4">
        <label className="flex flex-col gap-1.5 text-code text-s9">
          email
          <input
            // The dialog opened because you asked to sign in — the caret belongs here.
            autoFocus
            type="email"
            value={email}
            placeholder="you@example.org"
            aria-label="email"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
            className="slip min-w-0 rounded-r2 border border-s5 bg-s1 px-2.5 py-1 font-mono text-code text-s11 outline-none placeholder:text-s7 focus:border-s7"
          />
        </label>
        <span className="text-meta leading-relaxed text-s7">
          Claude&apos;s own sign-in opens in your browser, pre-filled with this email. coa keeps a
          pointer to the login — never the token.
        </span>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-s3 px-4 py-3">
        <Button variant="outline" onClick={() => setLoginEmailFor(undefined)}>
          cancel
        </Button>
        <Button variant="quiet" disabled={!valid} onClick={commit}>
          continue
        </Button>
      </footer>
    </>
  );
}

/** The indicator law, per phase: blue while coa works, amber when it needs YOU (the
 *  browser handshake, a mismatch decision), green done, red only for a real failure. */
function dotFor(flow: LoginSnapshot): 'running' | 'needs-you' | 'done' | 'critical' {
  if (flow.phase === 'registered') return 'done';
  if (flow.phase === 'failed') return 'critical';
  if (flow.phase === 'awaiting' || flow.phase === 'mismatch') return 'needs-you';
  return 'running';
}

function FlowBody({
  flow,
  onClose,
}: {
  flow: LoginSnapshot;
  onClose: () => void;
}): React.JSX.Element {
  const submitCode = useLogin((s) => s.submitCode);
  const resolveMismatch = useLogin((s) => s.resolveMismatch);
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);

  // The flow is Claude-only today (the daemon's LoginManager drives one CLI); the title
  // names the provider honestly rather than pretending a parameter exists.
  const title =
    flow.phase === 'registered'
      ? 'signed in'
      : flow.mode === 'relogin'
        ? `re-login ${flow.email ?? ''}`
        : 'sign in — new claude login';

  const retry = (): void => {
    if (flow.email === undefined) return;
    void useLogin
      .getState()
      .startLogin({
        providerId: 'claude',
        mode: flow.credentialId === undefined ? 'new' : 'relogin',
        email: flow.email,
        ...(flow.credentialId !== undefined ? { credentialId: flow.credentialId } : {}),
      })
      .catch(() => {});
  };

  return (
    <>
      <header className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
        <StatusDot status={dotFor(flow)} />
        <span className="truncate text-sec font-semibold text-s11">{title}</span>
        <span className="ml-auto flex-none font-mono text-meta text-s7">{flow.phase}</span>
      </header>

      {/* Phases advance only from polling — the swap is a cross-fade on the Slipstream
          curve, not a hard cut, so the dialog reads as one surface being re-pointed. */}
      <div className="relative min-h-24 px-4 py-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={flow.phase} {...RISE}>
            {flow.phase === 'launching' && (
              <Step
                heading="starting Claude sign-in"
                body={`coa is launching Claude's own sign-in for ${flow.email ?? 'this account'}. The browser opens pre-filled; coa watches for the login to land — it never reads your token.`}
              />
            )}

            {flow.phase === 'awaiting' && (
              <div className="flex flex-col gap-3">
                <Step
                  heading="finish signing in"
                  body={`Your browser opened Claude's sign-in with ${flow.email ?? 'your email'} pre-filled — finish there and come back. coa is watching for the login to land.`}
                />
                {flow.oauthUrl !== undefined ? (
                  <CopyLink url={flow.oauthUrl} />
                ) : flow.ptyCaptured === false ? (
                  // Degraded, honest, never blocking: without a PTY the CLI prints no URL,
                  // but the browser still opened and the probe still completes the flow.
                  <div className="rounded-r3 border border-s5 bg-s1 px-3 py-3 font-mono text-meta leading-relaxed text-s7">
                    the browser opened with your email pre-filled — the copyable link isn&apos;t
                    available on this system
                  </div>
                ) : null}
                {showCode ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && code.trim() !== '')
                          void submitCode(code.trim()).catch(() => {});
                      }}
                      placeholder="paste the code from the browser…"
                      aria-label="authorization code"
                      className="slip min-w-0 flex-1 rounded-r2 border border-s5 bg-s1 px-2.5 py-1 font-mono text-code text-s11 outline-none placeholder:text-s7 focus:border-s7"
                    />
                    <Button
                      variant="quiet"
                      disabled={code.trim() === ''}
                      onClick={() => void submitCode(code.trim()).catch(() => {})}
                    >
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
                body="Signed in — coa is polling `claude auth status` for the login to land. The moment it does, this account registers itself."
              />
            )}

            {flow.phase === 'mismatch' && (
              <Step
                heading={`signed in as ${flow.landedEmail ?? 'a different account'}`}
                body={`you asked to sign in as ${flow.email ?? 'another email'} — the browser finished as ${flow.landedEmail ?? 'a different account'}. Keep it, or try again with the right account?`}
              />
            )}

            {flow.phase === 'registered' && (
              <Step
                heading="you're in"
                body={`Signed in as ${flow.identity ?? flow.email ?? 'your account'}. coa stored a pointer to the login's folder — never the token.`}
              />
            )}

            {flow.phase === 'failed' && (
              <Step
                tone="crit"
                heading="sign-in didn't finish"
                body={
                  flow.error ??
                  'No login landed. Nothing was changed. Try again, or point coa at an existing config dir from the provider menu.'
                }
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-s3 px-4 py-3">
        {flow.phase === 'registered' ? (
          <Button variant="quiet" onClick={onClose}>
            done
          </Button>
        ) : flow.phase === 'failed' ? (
          <>
            <Button variant="outline" onClick={onClose}>
              close
            </Button>
            <Button variant="quiet" onClick={retry}>
              try again
            </Button>
          </>
        ) : flow.phase === 'mismatch' ? (
          // Flagged, never blocked: keeping the landed account is a plain quiet act,
          // not a warning to bully past.
          <>
            <Button variant="outline" onClick={() => void resolveMismatch('retry').catch(() => {})}>
              try again
            </Button>
            <Button variant="quiet" onClick={() => void resolveMismatch('keep').catch(() => {})}>
              keep {flow.landedEmail ?? 'this account'}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            cancel
          </Button>
        )}
      </footer>
    </>
  );
}

/** The captured stdout URL with the VSCode copy pattern — for when the auto-opened browser
 *  is the WRONG browser (the one that doesn't know your email), or didn't open at all. */
function CopyLink({ url }: { url: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-r3 border border-s5 bg-s1 px-3 py-3">
      <span className="flex items-center font-mono text-meta text-s7">
        didn&apos;t open? paste this into the browser that knows your email
        <Button
          variant="text"
          className="ml-auto"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? 'copied ✓' : 'copy link'}
        </Button>
      </span>
      <span className="font-mono text-code break-all text-s10">{url}</span>
    </div>
  );
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

import {
  BrandMark,
  Button,
  CapsLabel,
  Icon,
  MenuItem,
  ModalShell,
  StatusDot,
  Toggle,
  Tooltip,
  cx,
  useDismissLayer,
  type SessionStatus,
} from '@coa/console-kit';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { NO_DRAG } from '../shell/appRegion.js';
import { useShell } from '../shell/store.js';
import { RISE, SLIP_ENTER } from './motion.js';
import {
  addedProviders,
  chainPositions,
  credentialStatus,
  credentialsOf,
  poolHealth,
  useAuthStore,
  type Credential,
  type CredentialStatus,
} from './authStore.js';
import {
  LOCATOR_LABEL,
  PROVIDERS,
  isPointerLocator,
  providerById,
  type ProviderDescriptor,
} from './providers.js';
import { TextInput } from './fields.js';
import { SignInButton, useStartRelogin } from './LoginFlow.js';
import { providerAttention } from './loginStore.js';
import { ModelsSection } from './ModelEditor.js';
import { RowMenu } from './RowMenu.js';
import { SurfaceEmpty } from './surfaceStates.js';
import { useAuthUi } from './surfaceUi.js';
import { useNarrow } from './useNarrow.js';

/**
 * Auth — credentials only. Every number (spend, limits) lives on Usage; the separation is
 * deliberate, so this surface answers exactly one question: what can coa log in as?
 *
 * Two groups with different semantics ON PURPOSE. Agent backends are identity-shaped (ONE
 * active per provider). Tool services are capacity-shaped (a live pool per chain, failover +
 * cooldown, no "active"). The surface leans into the asymmetry rather than papering over it.
 *
 * Master–detail at width; the SAME two components stack into a drill-down when the pane is
 * narrow, so there is no second layout to maintain. The list column sits on the CANVAS ground
 * (s1), not the nav's (s2): it belongs to the surface, not to the app frame.
 */

/** Below this the detail pane has no room to be a pane, so the surface becomes a drill-down. */
const NARROW_PX = 640;

const STATUS_DOT: Record<CredentialStatus, SessionStatus> = {
  active: 'done',
  healthy: 'done',
  cooling: 'needs-you',
  expired: 'critical',
  disabled: 'idle',
};

/** Pure: the words a credential's state wears. `cooling` counts down, so it carries its time. */
export function statusText(c: Credential, status: CredentialStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'expired':
      return 'Login expired';
    case 'disabled':
      return 'Benched';
    case 'cooling':
      return `Cooling down · ${Math.floor((c.coolingSec ?? 0) / 60)}m ${(c.coolingSec ?? 0) % 60}s`;
    case 'healthy':
      return 'Healthy';
  }
}

/* ------------------------------- the title-bar strip ------------------------------- */

/** The title bar IS the surface's chrome: auth's name and, on a narrow pane, the
 *  drill-down's way back (the same place usage keeps its). The add control lives at the
 *  top of the provider list — with the things it adds to, not up in the frame. */
export function AuthStrip(): React.JSX.Element {
  const added = useAuthStore((s) => s.added);
  const refresh = useAuthStore((s) => s.refresh);
  const narrow = useAuthUi((s) => s.narrow);
  const selected = useAuthUi((s) => s.selected);
  const select = useAuthUi((s) => s.select);
  const drilled =
    narrow && selected !== undefined && added.includes(selected)
      ? providerById(selected)
      : undefined;

  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5 px-4" style={NO_DRAG}>
        {drilled === undefined ? (
          <>
            <span className="font-mono text-meta tracking-[0.06em] text-s9">Auth</span>
            {added.length > 0 && (
              <span className="font-mono text-meta text-s7">{added.length} providers</span>
            )}
          </>
        ) : (
          <>
            <Button variant="text" onClick={() => select(undefined)}>
              ‹ auth
            </Button>
            <span className="truncate text-sec font-[550] text-s12">{drilled.label}</span>
          </>
        )}
      </div>
      <div className="flex-1" />
      {/* Logins change behind coa's back (a `claude login` in a terminal) — re-read on
          demand. A frame-level act over the whole surface, so it lives in the strip.
          Sequenced, not concurrent: each RPC reprojects the FULL view it returns, so two
          in-flight reads would race on whose response lands last. The probe rides the same
          ⟳ — re-reading logins without re-judging their health would show half the truth. */}
      <Tooltip label="re-read logins" side="bottom">
        <button
          type="button"
          aria-label="Re-read logins"
          onClick={() =>
            void refresh()
              .then(() => useAuthStore.getState().probeHealth())
              .catch(() => {})
          }
          className="slip flex cursor-pointer items-center px-3.5 text-s7 hover:text-s10"
          style={NO_DRAG}
        >
          <Icon name="refresh" />
        </button>
      </Tooltip>
    </>
  );
}

/* ---------------------------------- the surface ---------------------------------- */

export function AuthSurface(): React.JSX.Element {
  const added = useAuthStore((s) => s.added);
  const selected = useAuthUi((s) => s.selected);
  const select = useAuthUi((s) => s.select);
  const setNarrow = useAuthUi((s) => s.setNarrow);
  const adding = useShell((s) => s.addProviderOpen);
  const setAdding = useShell((s) => s.setAddProviderOpen);
  const hostRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(hostRef, NARROW_PX);

  // Live daemon read on every mount (idempotent) — mirrors how the account selector
  // triggers `listAccounts`. The surface starts empty and hydrates in. Advisory by design:
  // a failed read degrades to the empty state, never an unhandled rejection. The health
  // probe follows the hydrate (sequenced — both reprojects the full view): surfacing the
  // logins without their probe-judged health would show yesterday's verdict as today's.
  useEffect(() => {
    void useAuthStore
      .getState()
      .hydrate()
      .then(() => useAuthStore.getState().probeHealth())
      .catch(() => {});
  }, []);

  // Becoming narrow always lands on the LIST: a selection made while both panes were
  // visible must not reopen as a drill-down you never chose to enter. The strip mirrors
  // the measurement so it can wear the back control.
  useEffect(() => {
    setNarrow(narrow);
    if (narrow) select(undefined);
  }, [narrow, select, setNarrow]);

  // A removed provider must not leave the detail pointing at a ghost. On a narrow pane the
  // ghost falls back to the list (not to a sibling you never picked); wide falls back to
  // the first provider, because the wide detail pane always shows SOMETHING.
  const chosen = selected !== undefined && added.includes(selected) ? selected : undefined;
  const active = chosen ?? added[0];

  // Esc climbs out of the drill-down. Registered on the kit's dismiss-layer stack, so a
  // menu or modal open above it still wins its own Escape first.
  useDismissLayer(narrow && chosen !== undefined, () => select(undefined));

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col">
      {added.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
          <SurfaceEmpty
            title="No providers yet"
            hint="add one to give coa something to log in as"
          />
          <Button variant="quiet" onClick={() => setAdding(true)}>
            + Add Provider
          </Button>
        </div>
      ) : narrow ? (
        // The drill-down: one pane at a time, swapped with the SAME cross-fade the wide
        // detail uses — the surface is re-pointed, not replaced (motion parity with usage's
        // overview ⇄ dashboard). Concurrent (no `mode="wait"`), vertical travel only.
        <div className="relative min-h-0 flex-1">
          <AnimatePresence initial={false}>
            {chosen === undefined ? (
              <motion.div key="list" className="absolute inset-0 flex flex-col" {...RISE}>
                <ProviderList selected={undefined} narrow onSelect={select} />
              </motion.div>
            ) : (
              <motion.div
                key={`detail-${chosen}`}
                className="absolute inset-0 flex flex-col"
                {...RISE}
              >
                {/* The way back lives in the title-bar strip (the usage pattern) — the
                    canvas is all detail. */}
                <ProviderDetail providerId={chosen} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ProviderList selected={active} narrow={false} onSelect={select} />
          {active !== undefined && (
            <div className="flex min-w-0 flex-1 flex-col">
              {/* The detail cross-fades between providers — one surface being re-pointed, not a
                  page being replaced. Concurrent (no `mode="wait"`): sequencing an exit before an
                  entrance is what made a 180ms swap feel like a 360ms one. */}
              <div className="relative min-h-0 flex-1">
                <AnimatePresence initial={false}>
                  <motion.div key={active} className="absolute inset-0 flex flex-col" {...RISE}>
                    <ProviderDetail providerId={active} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      )}

      <AddProviderDialog open={adding} onClose={() => setAdding(false)} onAdded={select} />
      <RemoveProviderDialog />
      <RemoveCredentialDialog />
    </div>
  );
}

/** The one destructive confirm on the surface: removing a provider takes every credential
 *  with it, which is big enough to ask first. The copy is honest about blast radius —
 *  coa FORGETS; nothing is revoked at the provider. */
function RemoveProviderDialog(): React.JSX.Element {
  const providerId = useShell((s) => s.confirmRemoveProvider);
  const setConfirm = useShell((s) => s.setConfirmRemoveProvider);
  const removeProvider = useAuthStore((s) => s.removeProvider);
  const count = useAuthStore(
    (s) => s.credentials.filter((c) => c.providerId === providerId).length,
  );
  // How many of the provider's logins carry a dedicated browser profile — zero renders no
  // opt-in at all (a provider that never used isolation removes exactly as it does today).
  const profiles = useAuthStore(
    (s) => s.credentials.filter((c) => c.providerId === providerId && c.hasProfile === true).length,
  );
  const provider = providerId === undefined ? undefined : providerById(providerId);
  const [alsoProfiles, setAlsoProfiles] = useState(false);
  const close = (): void => {
    setConfirm(undefined);
    setAlsoProfiles(false);
  };

  const consequence =
    provider === undefined
      ? ''
      : count === 0
        ? `Nothing is configured under it, so nothing else leaves with it.`
        : isPointerLocator(provider.locator)
          ? `coa stops tracking its ${count} ${provider.noun}${count === 1 ? '' : 's'}. The ${count === 1 ? 'login itself stays' : 'logins themselves stay'} where ${count === 1 ? 'it lives' : 'they live'}, and nothing is touched at ${provider.label}.`
          : `coa stops tracking its ${count} ${provider.noun}${count === 1 ? '' : 's'}. Removing is not revoking. A burned key is revoked at ${provider.label}, not here.`;

  return (
    <ModalShell
      open={provider !== undefined}
      onClose={close}
      aria-label="Remove Provider"
      className="w-96"
    >
      {provider !== undefined && (
        <>
          <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
            <BrandMark spec={provider.mark} />
            <span className="text-sec font-semibold text-s11">Remove {provider.label}?</span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-4 text-code leading-relaxed text-s9">
            <span>{consequence}</span>
            {profiles > 0 && (
              <label className="flex items-center gap-2.5">
                <Toggle
                  on={alsoProfiles}
                  onChange={setAlsoProfiles}
                  aria-label={`also delete their ${profiles} browser profile${profiles === 1 ? '' : 's'}`}
                />
                <span>{`also delete their ${profiles} browser profile${profiles === 1 ? '' : 's'}`}</span>
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                void removeProvider(provider.id, profiles > 0 ? alsoProfiles : undefined).catch(
                  () => {},
                );
                close();
              }}
            >
              <span className="text-crit">Remove Provider</span>
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/** Removing a login that has a dedicated browser profile asks about the profile too: it is
 *  tens of MB of cookie jar on disk, and deleting it is a filesystem act the user should
 *  see rather than inherit. Keeping it is the default — the cautious half of a destructive
 *  choice (profile cleanup only ever happens at the user's explicit request). */
function RemoveCredentialDialog(): React.JSX.Element {
  const id = useShell((s) => s.confirmRemoveCredential);
  const setConfirm = useShell((s) => s.setConfirmRemoveCredential);
  const removeCredential = useAuthStore((s) => s.removeCredential);
  const credential = useAuthStore((s) => s.credentials.find((c) => c.id === id));
  const [alsoProfile, setAlsoProfile] = useState(false);
  const close = (): void => {
    setConfirm(undefined);
    setAlsoProfile(false);
  };

  return (
    <ModalShell
      open={credential !== undefined}
      onClose={close}
      aria-label="Remove Login"
      className="w-96"
    >
      {credential !== undefined && (
        <>
          <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
            <span className="text-sec font-semibold text-s11">remove {credential.label}?</span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-4 text-code leading-relaxed text-s9">
            <span>
              coa forgets this login and deletes the sign-in it created for it. A config directory
              you pointed at yourself is left alone. Nothing is touched at the provider.
            </span>
            {credential.profileShared === true ? (
              // The jar belongs to an identity, not to this row, and another login still
              // signs in with it — deleting it would sign that one out too (profiles are keyed by identity, which several accounts can share).
              <span className="text-s8">
                Its browser profile stays: another login signs in as the same person and still uses
                it.
              </span>
            ) : (
              <label className="flex items-center gap-2.5">
                <Toggle
                  on={alsoProfile}
                  onChange={setAlsoProfile}
                  aria-label="Also delete the browser profile"
                />
                <span>Also delete the browser profile (its cookies and cache, tens of MB)</span>
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                void removeCredential(credential.id, alsoProfile).catch(() => {});
                close();
              }}
            >
              <span className="text-crit">Remove Login</span>
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/* ------------------------------------ the list ------------------------------------ */

function ProviderList({
  selected,
  narrow,
  onSelect,
}: {
  selected: string | undefined;
  narrow: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const added = useAuthStore((s) => s.added);
  const setAdding = useShell((s) => s.setAddProviderOpen);
  const backends = addedProviders(added, 'backend');
  const services = addedProviders(added, 'service');

  return (
    // The canvas ground (s1) — deliberately NOT the nav's s2. This column belongs to the
    // surface, not to the app frame; the hairline is what separates them. The gutter is
    // the chat canvas's (px-8), with the pill rows bleeding into it (-mx-3) — the same
    // inset-row idiom the transcript and browser wear.
    <div
      className={cx(
        'flex flex-col overflow-y-auto px-8 pt-6 pb-6',
        narrow ? 'min-w-0 flex-1' : 'w-64 flex-none border-r border-s3',
      )}
    >
      {/* The add control heads the list it adds to — a row-shaped citizen of the column,
          its + sitting in the mark slot so the labels rank. */}
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="slip group -mx-3 mb-4 flex w-[calc(100%+24px)] cursor-pointer items-center gap-2.5 rounded-r3 px-3 py-2 text-left text-sec text-s8 hover:bg-s2 hover:text-s11"
      >
        <span className="flex h-4 w-4 flex-none items-center justify-center font-mono text-s7 group-hover:text-s10">
          +
        </span>
        Add Provider
      </button>
      {backends.length > 0 && <CapsLabel className="px-0 pb-1.5">Agent backends</CapsLabel>}
      {backends.map((p) => (
        <ProviderRow
          key={p.id}
          provider={p}
          selected={p.id === selected}
          narrow={narrow}
          onSelect={onSelect}
        />
      ))}
      {services.length > 0 && <CapsLabel className="px-0 pt-5 pb-1.5">Tool services</CapsLabel>}
      {services.map((p) => (
        <ProviderRow
          key={p.id}
          provider={p}
          selected={p.id === selected}
          narrow={narrow}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  provider,
  selected,
  narrow,
  onSelect,
}: {
  provider: ProviderDescriptor;
  selected: boolean;
  narrow: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const all = useAuthStore((s) => s.credentials);
  const enabled = useAuthStore((s) => s.enabled[provider.id] ?? true);
  const activeByProvider = useAuthStore((s) => s.activeByProvider);
  const setProviderEnabled = useAuthStore((s) => s.setProviderEnabled);
  const credentials = credentialsOf(all, provider.id);
  const health = poolHealth(credentials);
  // The generic attention channel: logins on this provider the probe flagged (badge
  // surface #2 — the nav tab counts the whole surface, this dot marks the aisle).
  const attention = providerAttention(all, provider.id);
  // What this provider is CURRENTLY logging in as — the answer to the question the row is asked
  // most often, so it belongs on the row rather than one click inside it.
  const active = credentials.find((c) => activeByProvider[provider.id] === c.id);

  return (
    // The WHOLE row is the hit target (the stretched-link pattern): the button is absolutely
    // inset and the content rides above it, pointer-transparent. A button that only spans its own
    // text leaves most of a row's hover area dead — which is exactly what it felt like.
    <div
      className={cx(
        'slip group relative -mx-3 flex items-center gap-2.5 rounded-r3 px-3 py-2 text-sec',
        selected ? 'bg-s3 text-s12' : 'text-s10 hover:bg-s2 hover:text-s11',
      )}
    >
      <button
        type="button"
        aria-label={provider.label}
        onClick={() => onSelect(provider.id)}
        className="absolute inset-0 cursor-pointer rounded-r3"
      />

      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5">
        <BrandMark spec={provider.mark} muted={!enabled} />
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate', !enabled && 'text-s7')}>{provider.label}</span>
          {active !== undefined && (
            <span className="block truncate font-mono text-meta text-s7">{active.label}</span>
          )}
        </span>
        {/* One amber dot per row, whatever earned it (needs-relogin outranks cooling —
            same hue, and doubling the dot would be counting, which is the number's job). */}
        {(attention > 0 || health.cooling > 0) && <StatusDot status="needs-you" />}
        {credentials.length > 0 && (
          <span className="font-mono text-meta text-s7">{credentials.length}</span>
        )}
      </span>

      {/* The bench switch rides ABOVE the stretched link (its own pointer events), and stays out
          of the way until you come near — a provider's on/off is a decision, not an ornament. It
          stays visible while OFF, because that IS the state you need to see. */}
      <Tooltip label={enabled ? 'Bench this provider' : 'Un-bench this provider'} side="top">
        <span
          className={cx(
            'slip relative flex',
            enabled && !selected && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <Toggle
            on={enabled}
            onChange={(on) => void setProviderEnabled(provider.id, on).catch(() => {})}
            aria-label={`${provider.label} enabled`}
          />
        </span>
      </Tooltip>
      {narrow && <span className="relative font-mono text-meta text-s7">›</span>}
    </div>
  );
}

/* ----------------------------------- the detail ----------------------------------- */

function ProviderDetail({ providerId }: { providerId: string }): React.JSX.Element {
  const provider = providerById(providerId);
  const all = useAuthStore((s) => s.credentials);
  const activeByProvider = useAuthStore((s) => s.activeByProvider);
  const enabled = useAuthStore((s) => s.enabled[providerId] ?? true);
  const chains = useAuthStore((s) => s.chains);
  const setProviderEnabled = useAuthStore((s) => s.setProviderEnabled);
  const confirmRemove = useShell((s) => s.setConfirmRemoveProvider);
  const [adding, setAdding] = useState(false);
  const credentials = credentialsOf(all, providerId);

  if (provider === undefined) return <SurfaceEmpty title="Unknown provider" />;

  const positions = chainPositions(chains, providerId);
  // The version rides the subtitle where one applies — a fact about the seam coa drives,
  // in the row of facts about the seam.
  const subtitle = [
    provider.group === 'backend' ? 'Agent backend' : 'Tool service',
    ...(provider.group === 'service' ? positions : [LOCATOR_LABEL[provider.locator]]),
    ...(provider.version === undefined ? [] : [provider.version]),
  ].join(' · ');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-8">
      <div className="mx-auto max-w-160">
        <div className="flex items-center gap-3">
          <BrandMark spec={provider.mark} size={20} muted={!enabled} />
          <span className="text-body font-semibold text-s12">{provider.label}</span>
          <div className="ml-auto flex items-center gap-2.5">
            <Tooltip label={enabled ? 'Bench this provider' : 'Un-bench this provider'} side="top">
              <Toggle
                on={enabled}
                onChange={(on) => void setProviderEnabled(providerId, on).catch(() => {})}
                aria-label={`${provider.label} enabled`}
              />
            </Tooltip>
            <RowMenu label={`${provider.label} actions`}>
              {/* The advanced manual path — for a dir that's already logged in
                  (strict-superset: the driven flow is primary, never the only door). */}
              {provider.locator === 'config-dir' && (
                <MenuItem onClick={() => setAdding(true)}>
                  Point at an existing config dir…
                </MenuItem>
              )}
              {/* Removal takes every credential with it — big enough to ask first. */}
              <MenuItem onClick={() => confirmRemove(providerId)}>
                <span className="text-crit">Remove Provider…</span>
              </MenuItem>
            </RowMenu>
          </div>
        </div>
        <div className="mt-1 font-mono text-meta text-s7">{subtitle}</div>

        <AnimatePresence initial={false}>
          {!enabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={SLIP_ENTER}
              className="overflow-hidden"
            >
              <div className="mt-4 flex items-center gap-2 text-code text-s8">
                <StatusDot status="idle" />
                {provider.group === 'backend'
                  ? 'Benched. Its models are out of the picker, and the credentials are untouched.'
                  : 'Benched. It is skipped in every chain, and the keys are untouched.'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* mb breathes between the hairline and the first row — the rows are pills, and a
            pill flush against a rule reads as clipped. */}
        <div className="mt-7 mb-1.5 flex items-baseline border-b border-s3 pb-1.5">
          <CapsLabel className="px-0 pt-0">
            {provider.noun === 'login' ? 'logins' : 'keys'}
          </CapsLabel>
          <span className="ml-2 font-mono text-meta text-s7">{credentials.length}</span>
          {/* A config-dir backend is DRIVEN: coa runs the login itself, so the primary add
              path is "sign in" (email-first), not "point at a directory". The manual path
              stays reachable in the provider menu — strict-superset, never a cage. */}
          {provider.locator === 'config-dir' ? (
            <span className="ml-auto">
              <SignInButton provider={provider} />
            </span>
          ) : (
            <Button variant="text" className="ml-auto" onClick={() => setAdding(true)}>
              + Add {provider.noun}
            </Button>
          )}
        </div>

        {/* Adding a credential to the provider you are already LOOKING at is inline — a modal
            here would cover the very table it is adding to. */}
        <AnimatePresence initial={false}>
          {adding && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={SLIP_ENTER}
              className="overflow-hidden"
            >
              <AddCredentialRow provider={provider} onDone={() => setAdding(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {credentials.length === 0 && !adding && (
          <div className="py-6 text-center text-sec text-s7">
            No {provider.noun}s yet. Add one to use {provider.label}.
          </div>
        )}

        <AnimatePresence initial={false}>
          {credentials.map((c) => (
            <motion.div key={c.id} {...RISE}>
              <CredentialRow
                credential={c}
                provider={provider}
                status={credentialStatus(c, activeByProvider)}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* A backend's models section IS the editor — the editable list is the source of
            truth for both pickers, so the surface that shows it is the surface that edits
            it. A tool service has no models. */}
        {provider.group === 'backend' && <ModelsSection provider={provider} />}
      </div>
    </div>
  );
}

function CredentialRow({
  credential,
  provider,
  status,
}: {
  credential: Credential;
  provider: ProviderDescriptor;
  status: CredentialStatus;
}): React.JSX.Element {
  const makeActive = useAuthStore((s) => s.makeActive);
  const setCredentialDisabled = useAuthStore((s) => s.setCredentialDisabled);
  const removeCredential = useAuthStore((s) => s.removeCredential);
  const clearCooldown = useAuthStore((s) => s.clearCooldown);
  const startRelogin = useStartRelogin();
  // Probe-derived: the login behind this pointer no longer answers. Flagged, never
  // auto-switched (advisory) — the row keeps its place and gains the one act that heals it.
  const needsRelogin = credential.health === 'needs-relogin';
  const [replacing, setReplacing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Set only by right-click: the menu opens under the CURSOR, not under the ⋯ it happens
  // to share. Cleared on close so the ⋯ click anchors normally again.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number }>();

  if (replacing) {
    return (
      <ReplaceSecretRow
        credential={credential}
        provider={provider}
        onDone={() => setReplacing(false)}
      />
    );
  }
  if (editing) {
    return (
      <EditCredentialRow
        credential={credential}
        provider={provider}
        onDone={() => setEditing(false)}
      />
    );
  }

  const dim = status === 'disabled' || status === 'expired';
  // A backend picks ONE active login, so its rows ARE a radio group: clicking a row activates it.
  // (Burying the single most common act in a ⋯ menu was the wrong weight.) A service pool has no
  // "active", so its rows stay inert readings. The activating click is a stretched link — an
  // absolutely-inset button — so the ⋯ menu can sit ABOVE it instead of nesting inside it.
  const selectable = provider.group === 'backend' && status !== 'active' && !dim;

  return (
    // Two lines, not four columns: the name and what it points at belong together, and the state
    // is the one thing that earns the right-hand edge. (A row of splayed columns is the
    // spreadsheet this surface is trying not to be.)
    <div
      className={cx(
        'slip group relative flex w-full items-center gap-3 rounded-r3 px-3 py-2 text-left',
        status === 'active' ? 'bg-s3' : 'hover:bg-s2',
      )}
      // Right-click is the row's second door to the SAME ⋯ menu (the industry-standard
      // pairing) — no separate context menu to drift out of sync with it. The row CLAIMS
      // the event (stopPropagation): unclaimed right-clicks dismiss the open menu, and
      // the exclusivity registry closes any other menu the moment this one opens.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // The open menu is PORTALED, so its right-clicks bubble here through the React
        // tree (not the DOM). A click that isn't on the row itself must not reposition
        // the menu — menus don't get menus.
        if (e.target instanceof Node && !e.currentTarget.contains(e.target)) return;
        setMenuAt({ x: e.clientX, y: e.clientY });
        setMenuOpen(true);
      }}
    >
      {selectable && (
        <button
          type="button"
          aria-label={`Use ${credential.label}`}
          onClick={() => void makeActive(credential.id).catch(() => {})}
          className="absolute inset-0 cursor-pointer rounded-r3"
        />
      )}

      {/* The radio marker IS the active state for a backend: filled = the login coa logs in as.
          For a pool, the same slot carries the key's health dot. */}
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3">
        {provider.group === 'backend' ? (
          <span
            aria-hidden
            className={cx(
              'flex h-3 w-3 flex-none items-center justify-center rounded-full border',
              status === 'active' ? 'border-ok' : dim ? 'border-s5' : 'border-s7',
            )}
          >
            {status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
          </span>
        ) : (
          <StatusDot status={STATUS_DOT[status]} />
        )}
        <span className="min-w-0 flex-1">
          {/* Email-first: an email-defined login IS its email, so that's the first line.
              A nickname (label ≠ email) keeps rank, with the probe identity — which
              carries the email — beneath it; the raw pointer is the floor. */}
          <span
            className={cx(
              'block truncate text-sec',
              status === 'active' ? 'text-s12' : dim ? 'text-s7' : 'text-s10',
            )}
          >
            {credential.email !== undefined && credential.label === credential.email
              ? credential.email
              : credential.label}
          </span>
          {/* The mask is all a read may return — there is no secret here to reveal. */}
          <span className="block truncate font-mono text-meta text-s7">
            {credential.identity ??
              (credential.label === credential.email ? credential.masked : credential.email) ??
              credential.masked}
          </span>
        </span>
      </span>

      {/* "Use" appears on approach for a row you could switch to: the affordance says what the
          click does, so activating never requires opening a menu to discover it. */}
      {selectable && !needsRelogin && (
        <span className="pointer-events-none relative flex-none font-mono text-meta text-s8 opacity-0 group-hover:opacity-100">
          Use
        </span>
      )}
      {/* Re-login is the badge's primary act — one click into the driven flow. It rides
          ABOVE the stretched link (its own pointer events) and stays visible while the
          login is broken, because that IS the state that needs acting on. */}
      {needsRelogin && (
        <button
          type="button"
          onClick={() => startRelogin(credential)}
          className="slip relative flex-none cursor-pointer rounded-r1 border border-warn/40 px-1.5 py-0.5 font-mono text-meta text-warn hover:border-warn/70 hover:bg-warn/10"
        >
          Re-login
        </button>
      )}
      <span
        // nowrap: `active · needs relogin` must never break into two lines — the row's
        // middle (identity) is the min-w-0 column, so it truncates first instead.
        className={cx(
          'pointer-events-none relative flex-none font-mono text-meta whitespace-nowrap',
          needsRelogin
            ? 'text-warn'
            : status === 'active'
              ? 'text-ok'
              : status === 'cooling'
                ? 'text-warn'
                : status === 'expired'
                  ? 'text-crit'
                  : 'text-s7',
        )}
      >
        {/* An ACTIVE broken login says both facts — it stays active (never auto-switched),
            and it needs you. Anything else flagged just needs you. */}
        {needsRelogin
          ? status === 'active'
            ? 'Active · needs relogin'
            : 'Needs relogin'
          : statusText(credential, status)}
      </span>

      <span
        className={cx(
          'slip relative',
          menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <RowMenu
          label={`${credential.label} actions`}
          open={menuOpen}
          onOpenChange={(next) => {
            setMenuOpen(next);
            if (!next) setMenuAt(undefined);
          }}
          anchorPoint={menuAt}
        >
          {provider.group === 'backend' && (
            <MenuItem
              disabled={status === 'active' || status === 'disabled' || status === 'expired'}
              onClick={() => void makeActive(credential.id).catch(() => {})}
            >
              Make Active
            </MenuItem>
          )}
          <MenuItem
            onClick={() =>
              void setCredentialDisabled(credential.id, !credential.disabled).catch(() => {})
            }
          >
            {credential.disabled ? 'Un-bench' : 'Bench'}
          </MenuItem>
          {/* Edit touches only what coa can READ BACK — the label, a pointer's target. */}
          <MenuItem onClick={() => setEditing(true)}>Edit…</MenuItem>
          {/* A SECRET is never edited (coa cannot show what it cannot read): a key is
              replaced — an add that supersedes. A pointer's secret lives with the provider,
              so its only recovery act is re-login — the DRIVEN flow for a config dir
              (offered on expiry or a probe flag), an inline replace for an env-var. */}
          {isPointerLocator(provider.locator) ? (
            provider.locator === 'config-dir' ? (
              (status === 'expired' || needsRelogin) && (
                <MenuItem onClick={() => startRelogin(credential)}>Re-login…</MenuItem>
              )
            ) : (
              status === 'expired' && (
                <MenuItem onClick={() => setReplacing(true)}>Replace…</MenuItem>
              )
            )
          ) : (
            <MenuItem onClick={() => setReplacing(true)}>Replace {provider.noun}…</MenuItem>
          )}
          {status === 'cooling' && (
            <MenuItem onClick={() => void clearCooldown(credential.id).catch(() => {})}>
              Clear Cooldown
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              // a login that never used isolation has nothing to ask about — one click,
              // exactly as it did before isolated login profiles existed. `hasProfile` is the only thing that
              // routes this through a prompt instead.
              if (credential.hasProfile === true) {
                useShell.getState().setConfirmRemoveCredential(credential.id);
              } else {
                void removeCredential(credential.id, undefined).catch(() => {});
              }
            }}
          >
            <span className="text-crit">Remove</span>
          </MenuItem>
        </RowMenu>
      </span>
    </div>
  );
}

/* ------------------------------- credential forms ------------------------------- */

/** The paste-once row. What it collects is chosen by the LOCATOR KIND, never by the provider. */
function AddCredentialRow({
  provider,
  onDone,
}: {
  provider: ProviderDescriptor;
  onDone: () => void;
}): React.JSX.Element {
  const addCredential = useAuthStore((s) => s.addCredential);
  const existing = useAuthStore(
    (s) => s.credentials.filter((c) => c.providerId === provider.id).length,
  );
  // Seeded from the ID, not the display label: this string is a VALUE the user keeps
  // (and the HUD's meter ids point at it), so recasing the provider's name must not move it.
  const [label, setLabel] = useState(`${provider.id}-${existing + 1}`);
  const [secret, setSecret] = useState('');

  // An open inline form is a dismiss layer: Escape closes IT first, wherever focus sits,
  // and only the next Escape climbs further (out of a drill-down, say).
  useDismissLayer(true, onDone);

  const commit = (): void => {
    if (secret.trim() === '') return;
    void addCredential(
      provider.id,
      label.trim() === '' ? `${provider.id}-${existing + 1}` : label,
      secret,
    ).catch(() => {});
    onDone();
  };

  return (
    // mb: the box must keep the same breath from the first row that the hairline keeps
    // from the box (inside the animated wrapper, so the gap grows in with it).
    <div className="mb-1.5 flex flex-col gap-2 rounded-r3 border border-s4 bg-s2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <TextInput value={label} onChange={setLabel} placeholder="Label" className="w-32" />
        {provider.locator === 'config-dir' ? (
          <DirField
            autoFocus
            value={secret}
            onChange={setSecret}
            onCommit={commit}
            onCancel={onDone}
            placeholder="~/.claude-work"
          />
        ) : (
          <TextInput
            autoFocus
            value={secret}
            onChange={setSecret}
            onCommit={commit}
            onCancel={onDone}
            placeholder={`paste the ${provider.noun}…`}
            type="password"
            className="flex-1"
          />
        )}
        <Button variant="quiet" disabled={secret.trim() === ''} onClick={commit}>
          Add
        </Button>
        <Button variant="text" onClick={onDone}>
          esc
        </Button>
      </div>
      <span className="text-meta leading-relaxed text-s7">{provider.hint}</span>
    </div>
  );
}

/** Edit touches what coa can READ BACK: the label always, a pointer locator's target too.
 *  A keyed credential's secret has no field here at all — remove and re-add is the only
 *  path that touches a key, so nothing on this row can even ask for one. */
function EditCredentialRow({
  credential,
  provider,
  onDone,
}: {
  credential: Credential;
  provider: ProviderDescriptor;
  onDone: () => void;
}): React.JSX.Element {
  const renameCredential = useAuthStore((s) => s.renameCredential);
  const replaceSecret = useAuthStore((s) => s.replaceSecret);
  const pointer = isPointerLocator(provider.locator);
  const [label, setLabel] = useState(credential.label);
  // The pointer is visible state (it IS what a read returns), so it prefills — the one
  // thing an edit form owes you is what you are editing.
  const [target, setTarget] = useState(pointer ? credential.masked : '');

  // Escape abandons the edit from anywhere in the row, not just from inside a field.
  useDismissLayer(true, onDone);

  const commit = (): void => {
    const renamed = label.trim() !== '' && label.trim() !== credential.label;
    // Re-pointing rides the replace path on purpose: a moved pointer clears what the old
    // target earned (cooldown, expiry), exactly like a fresh secret does.
    const repointed = pointer && target.trim() !== '' && target.trim() !== credential.masked;
    // Sequenced (not fired concurrently): each RPC reprojects the FULL view it returns, so
    // two in-flight calls would race on which one's response lands last and gets applied.
    if (renamed || repointed) {
      void (async () => {
        if (renamed) await renameCredential(credential.id, label);
        if (repointed) await replaceSecret(credential.id, target);
      })().catch(() => {});
    }
    onDone();
  };

  return (
    <div className="flex items-center gap-2 rounded-r3 border border-s4 bg-s2 px-3 py-2.5">
      <TextInput
        autoFocus
        value={label}
        onChange={setLabel}
        onCommit={commit}
        onCancel={onDone}
        placeholder="Label"
        className={pointer ? 'w-32' : 'flex-1'}
      />
      {pointer &&
        (provider.locator === 'config-dir' ? (
          <DirField
            value={target}
            onChange={setTarget}
            onCommit={commit}
            onCancel={onDone}
            placeholder="~/.claude-work"
          />
        ) : (
          <TextInput
            value={target}
            onChange={setTarget}
            onCommit={commit}
            onCancel={onDone}
            placeholder="GEMINI_API_KEY"
            className="flex-1"
          />
        ))}
      <Button variant="quiet" disabled={label.trim() === ''} onClick={commit}>
        Save
      </Button>
      <Button variant="text" onClick={onDone}>
        esc
      </Button>
    </div>
  );
}

function ReplaceSecretRow({
  credential,
  provider,
  onDone,
}: {
  credential: Credential;
  provider: ProviderDescriptor;
  onDone: () => void;
}): React.JSX.Element {
  const replaceSecret = useAuthStore((s) => s.replaceSecret);
  const [secret, setSecret] = useState('');

  // Escape abandons the replace from anywhere in the row, not just from inside a field.
  useDismissLayer(true, onDone);

  const commit = (): void => {
    if (secret.trim() === '') return;
    void replaceSecret(credential.id, secret).catch(() => {});
    onDone();
  };
  return (
    <div className="flex items-center gap-2 rounded-r3 border border-s4 bg-s2 px-3 py-2.5">
      <span className="w-28 flex-none truncate text-sec text-s10">{credential.label}</span>
      {provider.locator === 'config-dir' ? (
        <DirField
          autoFocus
          value={secret}
          onChange={setSecret}
          onCommit={commit}
          onCancel={onDone}
          placeholder="Point at the config directory again…"
        />
      ) : (
        <TextInput
          autoFocus
          value={secret}
          onChange={setSecret}
          onCommit={commit}
          onCancel={onDone}
          placeholder={`paste the replacement ${provider.noun}…`}
          type="password"
          className="flex-1"
        />
      )}
      <Button variant="quiet" disabled={secret.trim() === ''} onClick={commit}>
        Replace
      </Button>
      <Button variant="text" onClick={onDone}>
        esc
      </Button>
    </div>
  );
}

/** A directory field with the industry-standard escape hatch: browse opens the OS folder
 *  picker (main owns the dialog — the renderer only ever receives the chosen path). Typing
 *  stays first-class; the picker is for when a path is easier found than remembered. */
function DirField({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  placeholder: string;
  autoFocus?: boolean;
}): React.JSX.Element {
  // The bridge is absent under jsdom — the button quietly does nothing there.
  const bridge = (window as { coa?: Window['coa'] }).coa;
  const browse = async (): Promise<void> => {
    const res = await bridge?.pickDirectory(
      value.trim() === '' ? {} : { defaultPath: value.trim() },
    );
    if (res?.path !== undefined) onChange(res.path);
  };
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <TextInput
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        {...(onCommit !== undefined ? { onCommit } : {})}
        {...(onCancel !== undefined ? { onCancel } : {})}
        placeholder={placeholder}
        className="flex-1"
      />
      <Button variant="text" onClick={() => void browse()}>
        Browse…
      </Button>
    </span>
  );
}

/* --------------------------------- add provider --------------------------------- */

/** Step 1 picks a provider; step 2 is the form for its LOCATOR KIND. Four kinds ⇒ four forms,
 *  forever: a new provider is a registry row and reuses one of them. */
function AddProviderDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (providerId: string) => void;
}): React.JSX.Element {
  const added = useAuthStore((s) => s.added);
  const addProvider = useAuthStore((s) => s.addProvider);
  const addCredential = useAuthStore((s) => s.addCredential);
  const [picked, setPicked] = useState<ProviderDescriptor>();
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');

  const reset = (): void => {
    setPicked(undefined);
    setLabel('');
    setSecret('');
  };

  // Step 2 is a layer over step 1: Escape walks BACK to the catalogue first, and only the
  // next Escape closes the dialog (ModalShell's own layer, registered beneath this one).
  useDismissLayer(open && picked !== undefined, reset);
  const close = (): void => {
    reset();
    onClose();
  };
  const commit = (): void => {
    if (picked === undefined || secret.trim() === '') return;
    const providerId = picked.id;
    // The default credential name is a VALUE the user keeps, so it comes from the id,
    // not from the provider's display name.
    const chosenLabel = label.trim() === '' ? picked.id : label;
    // The provider must exist server-side before its first credential can attach to it —
    // sequenced, not fired concurrently.
    void (async () => {
      await addProvider(providerId);
      await addCredential(providerId, chosenLabel, secret);
    })().catch(() => {});
    onAdded(providerId);
    close();
  };

  return (
    <ModalShell open={open} onClose={close} aria-label="Add provider" className="w-124">
      <AnimatePresence mode="wait" initial={false}>
        {picked === undefined ? (
          <motion.div key="catalogue" {...RISE}>
            <CapsLabel className="border-b border-s3 px-4 py-3">Add Provider</CapsLabel>
            <div className="max-h-100 overflow-y-auto px-4 pt-1 pb-4">
              <CapsLabel className="px-0 pt-3 pb-1.5">Agent backends</CapsLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {PROVIDERS.filter((p) => p.group === 'backend').map((p) => (
                  <ProviderTile
                    key={p.id}
                    provider={p}
                    already={added.includes(p.id)}
                    onPick={setPicked}
                  />
                ))}
              </div>
              <CapsLabel className="px-0 pt-4 pb-1.5">Tool services</CapsLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {PROVIDERS.filter((p) => p.group === 'service').map((p) => (
                  <ProviderTile
                    key={p.id}
                    provider={p}
                    already={added.includes(p.id)}
                    onPick={setPicked}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="form" {...RISE}>
            <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
              <BrandMark spec={picked.mark} />
              <span className="text-sec font-semibold text-s11">{picked.label}</span>
              <span className="font-mono text-meta text-s7">
                {picked.group === 'backend' ? 'Agent backend' : 'Tool service'}
              </span>
            </div>
            <div className="flex flex-col gap-4 px-4 py-4">
              <label className="flex flex-col gap-1.5 text-code text-s9">
                Label
                <TextInput value={label} onChange={setLabel} placeholder={picked.id} />
              </label>
              <label className="flex flex-col gap-1.5 text-code text-s9">
                {LOCATOR_LABEL[picked.locator]}
                {picked.locator === 'config-dir' ? (
                  <DirField
                    autoFocus
                    value={secret}
                    onChange={setSecret}
                    onCommit={commit}
                    placeholder="~/.claude-work"
                  />
                ) : (
                  <TextInput
                    autoFocus
                    value={secret}
                    onChange={setSecret}
                    onCommit={commit}
                    placeholder={
                      picked.locator === 'env-var' ? 'GEMINI_API_KEY' : `Paste the ${picked.noun}…`
                    }
                    type={picked.locator === 'key-file' ? 'password' : 'text'}
                  />
                )}
              </label>
              <span className="text-meta leading-relaxed text-s7">{picked.hint}</span>
              <div className="flex items-center gap-2 text-code text-s8">
                <StatusDot status="idle" />
                Not verified. coa never calls a provider to check a credential, so it goes live on
                first use.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button variant="quiet" disabled={secret.trim() === ''} onClick={commit}>
                Add {picked.noun}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalShell>
  );
}

function ProviderTile({
  provider,
  already,
  onPick,
}: {
  provider: ProviderDescriptor;
  already: boolean;
  onPick: (p: ProviderDescriptor) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={already}
      onClick={() => onPick(provider)}
      className={cx(
        'slip slip-press flex items-center gap-2.5 rounded-r3 border px-3 py-2.5 text-sec',
        already
          ? 'cursor-default border-s3 text-s7'
          : 'cursor-pointer border-s4 bg-s3 text-s11 hover:border-s6 hover:bg-s4 active:scale-[0.98]',
      )}
    >
      <BrandMark spec={provider.mark} muted={already} />
      <span className="min-w-0 flex-1 truncate text-left">{provider.label}</span>
      <span className="font-mono text-meta text-s7">
        {already ? 'Added' : LOCATOR_LABEL[provider.locator].split(' ')[0]}
      </span>
    </button>
  );
}

import {
  BrandMark,
  Button,
  CapsLabel,
  MenuItem,
  ModalShell,
  PopoverCard,
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
  useMockAuth,
  type Credential,
  type CredentialStatus,
} from './mockAuth.js';
import {
  LOCATOR_LABEL,
  PROVIDERS,
  isPointerLocator,
  providerById,
  type ProviderDescriptor,
  type ProviderModel,
} from './providers.js';
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
      return 'active';
    case 'expired':
      return 'login expired';
    case 'disabled':
      return 'benched';
    case 'cooling':
      return `cooling down · ${Math.floor((c.coolingSec ?? 0) / 60)}m ${(c.coolingSec ?? 0) % 60}s`;
    case 'healthy':
      return 'healthy';
  }
}

/* ------------------------------- the title-bar strip ------------------------------- */

/** The title bar IS the surface's chrome: auth's name and, on a narrow pane, the
 *  drill-down's way back (the same place usage keeps its). The add control lives at the
 *  top of the provider list — with the things it adds to, not up in the frame. */
export function AuthStrip(): React.JSX.Element {
  const added = useMockAuth((s) => s.added);
  const refresh = useMockAuth((s) => s.refresh);
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
            <span className="font-mono text-meta tracking-[0.06em] text-s9">auth</span>
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
          demand. A frame-level act over the whole surface, so it lives in the strip. */}
      <Tooltip label="re-read logins" side="bottom">
        <button
          type="button"
          aria-label="re-read logins"
          onClick={refresh}
          className="slip flex cursor-pointer items-center px-3.5 text-[15px] text-s7 hover:text-s10"
          style={NO_DRAG}
        >
          ⟳
        </button>
      </Tooltip>
    </>
  );
}

/* ---------------------------------- the surface ---------------------------------- */

export function AuthSurface(): React.JSX.Element {
  const added = useMockAuth((s) => s.added);
  const selected = useAuthUi((s) => s.selected);
  const select = useAuthUi((s) => s.select);
  const setNarrow = useAuthUi((s) => s.setNarrow);
  const adding = useShell((s) => s.addProviderOpen);
  const setAdding = useShell((s) => s.setAddProviderOpen);
  const hostRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(hostRef, NARROW_PX);

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
            + add provider
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
      <ModelsDialog />
    </div>
  );
}

/** The one destructive confirm on the surface: removing a provider takes every credential
 *  with it, which is big enough to ask first. The copy is honest about blast radius —
 *  coa FORGETS; nothing is revoked at the provider. */
function RemoveProviderDialog(): React.JSX.Element {
  const providerId = useShell((s) => s.confirmRemoveProvider);
  const setConfirm = useShell((s) => s.setConfirmRemoveProvider);
  const removeProvider = useMockAuth((s) => s.removeProvider);
  const count = useMockAuth((s) => s.credentials.filter((c) => c.providerId === providerId).length);
  const provider = providerId === undefined ? undefined : providerById(providerId);
  const close = (): void => setConfirm(undefined);

  const consequence =
    provider === undefined
      ? ''
      : count === 0
        ? `Nothing is configured under it — nothing else leaves with it.`
        : isPointerLocator(provider.locator)
          ? `coa forgets its ${count} ${provider.noun}${count === 1 ? '' : 's'}. The ${count === 1 ? 'login itself stays' : 'logins themselves stay'} where ${count === 1 ? 'it lives' : 'they live'} — nothing is touched at ${provider.label}.`
          : `coa forgets its ${count} ${provider.noun}${count === 1 ? '' : 's'}. Forgetting is not revoking — a burned key is revoked at ${provider.label}, not here.`;

  return (
    <ModalShell
      open={provider !== undefined}
      onClose={close}
      aria-label="remove provider"
      className="w-96"
    >
      {provider !== undefined && (
        <>
          <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
            <BrandMark spec={provider.mark} />
            <span className="text-sec font-semibold text-s11">remove {provider.label}?</span>
          </div>
          <div className="px-4 py-4 text-code leading-relaxed text-s9">{consequence}</div>
          <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
            <Button variant="outline" onClick={close}>
              cancel
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                removeProvider(provider.id);
                close();
              }}
            >
              <span className="text-crit">remove provider</span>
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
  const added = useMockAuth((s) => s.added);
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
        add provider
      </button>
      {backends.length > 0 && <CapsLabel className="px-0 pb-1.5">agent backends</CapsLabel>}
      {backends.map((p) => (
        <ProviderRow
          key={p.id}
          provider={p}
          selected={p.id === selected}
          narrow={narrow}
          onSelect={onSelect}
        />
      ))}
      {services.length > 0 && <CapsLabel className="px-0 pt-5 pb-1.5">tool services</CapsLabel>}
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
  const all = useMockAuth((s) => s.credentials);
  const enabled = useMockAuth((s) => s.enabled[provider.id] ?? true);
  const activeByProvider = useMockAuth((s) => s.activeByProvider);
  const setProviderEnabled = useMockAuth((s) => s.setProviderEnabled);
  const credentials = credentialsOf(all, provider.id);
  const health = poolHealth(credentials);
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
        {health.cooling > 0 && <StatusDot status="needs-you" />}
        {credentials.length > 0 && (
          <span className="font-mono text-meta text-s7">{credentials.length}</span>
        )}
      </span>

      {/* The bench switch rides ABOVE the stretched link (its own pointer events), and stays out
          of the way until you come near — a provider's on/off is a decision, not an ornament. It
          stays visible while OFF, because that IS the state you need to see. */}
      <Tooltip label={enabled ? 'bench this provider' : 'un-bench this provider'} side="top">
        <span
          className={cx(
            'slip relative flex',
            enabled && !selected && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <Toggle
            on={enabled}
            onChange={(on) => setProviderEnabled(provider.id, on)}
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
  const all = useMockAuth((s) => s.credentials);
  const activeByProvider = useMockAuth((s) => s.activeByProvider);
  const enabled = useMockAuth((s) => s.enabled[providerId] ?? true);
  const chains = useMockAuth((s) => s.chains);
  const setProviderEnabled = useMockAuth((s) => s.setProviderEnabled);
  const confirmRemove = useShell((s) => s.setConfirmRemoveProvider);
  const [adding, setAdding] = useState(false);
  const credentials = credentialsOf(all, providerId);

  if (provider === undefined) return <SurfaceEmpty title="Unknown provider" />;

  const positions = chainPositions(chains, providerId);
  // The version rides the subtitle where one applies — a fact about the seam coa drives,
  // in the row of facts about the seam.
  const subtitle = [
    provider.group === 'backend' ? 'agent backend' : 'tool service',
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
            <Tooltip label={enabled ? 'bench this provider' : 'un-bench this provider'} side="top">
              <Toggle
                on={enabled}
                onChange={(on) => setProviderEnabled(providerId, on)}
                aria-label={`${provider.label} enabled`}
              />
            </Tooltip>
            <RowMenu label={`${provider.label} actions`}>
              {/* Removal takes every credential with it — big enough to ask first. */}
              <MenuItem onClick={() => confirmRemove(providerId)}>
                <span className="text-crit">remove provider…</span>
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
                  ? 'Benched — its models are out of the picker. The credentials are untouched.'
                  : 'Benched — skipped in every chain. The keys are untouched.'}
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
          <Button variant="text" className="ml-auto" onClick={() => setAdding(true)}>
            + add {provider.noun}
          </Button>
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
            no {provider.noun}s yet — add one to use {provider.label}
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

        {(provider.models?.length ?? 0) > 0 && <ModelsSection provider={provider} />}
      </div>
    </div>
  );
}

/* ----------------------------------- the models ----------------------------------- */

/** Past this many, the rest live behind "all N models…" (the OpenRouter problem: a list
 *  that long stops being a glance, so the long tail moves to a filterable dialog). */
const MODELS_SHOWN = 6;

/** What this backend can run, and which of it the picker shows. Hiding is a VIEW
 *  preference — the model stays runnable by id — so the toggle mirrors the bench switch
 *  vocabulary without ever meaning capability. */
function ModelsSection({ provider }: { provider: ProviderDescriptor }): React.JSX.Element {
  const hiddenModels = useMockAuth((s) => s.hiddenModels);
  const openAll = useShell((s) => s.setModelsDialogProvider);
  const models = provider.models ?? [];
  const hiddenCount = models.filter((m) => hiddenModels.includes(m.id)).length;
  const shown = models.slice(0, MODELS_SHOWN);

  return (
    <>
      <div className="mt-7 mb-1.5 flex items-baseline border-b border-s3 pb-1.5">
        <CapsLabel className="px-0 pt-0">models</CapsLabel>
        <span className="ml-2 font-mono text-meta text-s7">{models.length}</span>
        {hiddenCount > 0 && (
          <span className="ml-2 font-mono text-meta text-s7">{hiddenCount} hidden</span>
        )}
      </div>
      {shown.map((m) => (
        <ModelRow key={m.id} model={m} />
      ))}
      {models.length > MODELS_SHOWN && (
        <button
          type="button"
          onClick={() => openAll(provider.id)}
          className="slip flex w-full cursor-pointer items-center rounded-r3 px-3 py-1.5 text-left font-mono text-meta text-s8 hover:bg-s2 hover:text-s11"
        >
          all {models.length} models…
        </button>
      )}
    </>
  );
}

function ModelRow({ model }: { model: ProviderModel }): React.JSX.Element {
  const hidden = useMockAuth((s) => s.hiddenModels.includes(model.id));
  const setModelHidden = useMockAuth((s) => s.setModelHidden);
  return (
    <div className="slip group flex items-center gap-3 rounded-r3 px-3 py-1.5 hover:bg-s2">
      <span className={cx('min-w-0 flex-1 truncate text-sec', hidden ? 'text-s7' : 'text-s10')}>
        {model.label}
      </span>
      <span className="truncate font-mono text-meta text-s7">{model.id}</span>
      {/* Same reveal contract as the bench switch: out of the way until approached,
          visible while OFF because that IS the state worth seeing. */}
      <Tooltip
        label={hidden ? 'show in the model picker' : 'hide from the model picker'}
        side="top"
      >
        <span
          className={cx(
            'slip flex',
            !hidden && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <Toggle
            on={!hidden}
            onChange={(on) => setModelHidden(model.id, !on)}
            aria-label={`${model.label} in the picker`}
          />
        </span>
      </Tooltip>
    </div>
  );
}

/** The full model list, filterable — where a long tail goes to be found. The same rows,
 *  the same toggles: the dialog is a bigger window onto the SAME list, not a second UI. */
function ModelsDialog(): React.JSX.Element {
  const providerId = useShell((s) => s.modelsDialogProvider);
  const setOpen = useShell((s) => s.setModelsDialogProvider);
  const [query, setQuery] = useState('');
  const provider = providerId === undefined ? undefined : providerById(providerId);
  const close = (): void => setOpen(undefined);

  // A fresh open is a fresh search — yesterday's filter is not a preference.
  useEffect(() => {
    if (providerId !== undefined) setQuery('');
  }, [providerId]);

  const models = (provider?.models ?? []).filter((m) =>
    `${m.label} ${m.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <ModalShell open={provider !== undefined} onClose={close} aria-label="models" className="w-124">
      {provider !== undefined && (
        <>
          <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
            <BrandMark spec={provider.mark} />
            <span className="text-sec font-semibold text-s11">{provider.label} models</span>
            <span className="font-mono text-meta text-s7">{provider.models?.length}</span>
          </div>
          <div className="px-4 pt-3">
            <Field
              autoFocus
              value={query}
              onChange={setQuery}
              placeholder="filter models…"
              className="w-full"
            />
          </div>
          <div className="max-h-100 overflow-y-auto px-4 pt-2 pb-4">
            {models.map((m) => (
              <ModelRow key={m.id} model={m} />
            ))}
            {models.length === 0 && (
              <div className="py-6 text-center text-sec text-s7">
                no model matches &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        </>
      )}
    </ModalShell>
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
  const makeActive = useMockAuth((s) => s.makeActive);
  const setCredentialDisabled = useMockAuth((s) => s.setCredentialDisabled);
  const removeCredential = useMockAuth((s) => s.removeCredential);
  const clearCooldown = useMockAuth((s) => s.clearCooldown);
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
          aria-label={`use ${credential.label}`}
          onClick={() => makeActive(credential.id)}
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
          <span
            className={cx(
              'block truncate text-sec',
              status === 'active' ? 'text-s12' : dim ? 'text-s7' : 'text-s10',
            )}
          >
            {credential.label}
          </span>
          {/* The mask is all a read may return — there is no secret here to reveal. */}
          <span className="block truncate font-mono text-meta text-s7">
            {credential.identity ?? credential.masked}
          </span>
        </span>
      </span>

      {/* "use" appears on approach for a row you could switch to: the affordance says what the
          click does, so activating never requires opening a menu to discover it. */}
      {selectable && (
        <span className="pointer-events-none relative flex-none font-mono text-meta text-s8 opacity-0 group-hover:opacity-100">
          use
        </span>
      )}
      <span
        className={cx(
          'pointer-events-none relative flex-none font-mono text-meta',
          status === 'active'
            ? 'text-ok'
            : status === 'cooling'
              ? 'text-warn'
              : status === 'expired'
                ? 'text-crit'
                : 'text-s7',
        )}
      >
        {statusText(credential, status)}
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
              onClick={() => makeActive(credential.id)}
            >
              make active
            </MenuItem>
          )}
          <MenuItem onClick={() => setCredentialDisabled(credential.id, !credential.disabled)}>
            {credential.disabled ? 'un-bench' : 'bench'}
          </MenuItem>
          {/* Edit touches only what coa can READ BACK — the label, a pointer's target. */}
          <MenuItem onClick={() => setEditing(true)}>edit…</MenuItem>
          {/* A SECRET is never edited (coa cannot show what it cannot read): a key is
              replaced — an add that supersedes. A pointer's secret lives with the provider,
              so its only recovery act is re-login, and only expiry calls for it. */}
          {isPointerLocator(provider.locator) ? (
            status === 'expired' && (
              <MenuItem onClick={() => setReplacing(true)}>
                {provider.locator === 'config-dir' ? 're-login…' : 'replace…'}
              </MenuItem>
            )
          ) : (
            <MenuItem onClick={() => setReplacing(true)}>replace {provider.noun}…</MenuItem>
          )}
          {status === 'cooling' && (
            <MenuItem onClick={() => clearCooldown(credential.id)}>clear cooldown</MenuItem>
          )}
          <MenuItem onClick={() => removeCredential(credential.id)}>
            <span className="text-crit">remove</span>
          </MenuItem>
        </RowMenu>
      </span>
    </div>
  );
}

function RowMenu({
  label,
  open: controlledOpen,
  onOpenChange,
  anchorPoint,
  children,
}: {
  label: string;
  /** Controlled pair — a row that also opens this menu on right-click owns the state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Present while the menu was opened by right-click: anchor under the cursor. */
  anchorPoint?: { x: number; y: number } | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align={anchorPoint === undefined ? 'end' : 'start'}
      anchorPoint={anchorPoint}
      className="w-44"
      trigger={
        <button
          type="button"
          aria-label={label}
          className="slip flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-r2 text-s7 hover:bg-s4 hover:text-s11"
        >
          ⋯
        </button>
      }
    >
      <div onClick={() => setOpen(false)}>{children}</div>
    </PopoverCard>
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
  const addCredential = useMockAuth((s) => s.addCredential);
  const existing = useMockAuth(
    (s) => s.credentials.filter((c) => c.providerId === provider.id).length,
  );
  const [label, setLabel] = useState(`${provider.label}-${existing + 1}`);
  const [secret, setSecret] = useState('');

  // An open inline form is a dismiss layer: Escape closes IT first, wherever focus sits,
  // and only the next Escape climbs further (out of a drill-down, say).
  useDismissLayer(true, onDone);

  const commit = (): void => {
    if (secret.trim() === '') return;
    addCredential(
      provider.id,
      label.trim() === '' ? `${provider.label}-${existing + 1}` : label,
      secret,
    );
    onDone();
  };

  return (
    // mb: the box must keep the same breath from the first row that the hairline keeps
    // from the box (inside the animated wrapper, so the gap grows in with it).
    <div className="mb-1.5 flex flex-col gap-2 rounded-r3 border border-s4 bg-s2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Field value={label} onChange={setLabel} placeholder="label" className="w-32" />
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
          <Field
            autoFocus
            value={secret}
            onChange={setSecret}
            onCommit={commit}
            onCancel={onDone}
            placeholder={`paste the ${provider.noun}…`}
            secret
            className="flex-1"
          />
        )}
        <Button variant="quiet" disabled={secret.trim() === ''} onClick={commit}>
          add
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
  const renameCredential = useMockAuth((s) => s.renameCredential);
  const replaceSecret = useMockAuth((s) => s.replaceSecret);
  const pointer = isPointerLocator(provider.locator);
  const [label, setLabel] = useState(credential.label);
  // The pointer is visible state (it IS what a read returns), so it prefills — the one
  // thing an edit form owes you is what you are editing.
  const [target, setTarget] = useState(pointer ? credential.masked : '');

  // Escape abandons the edit from anywhere in the row, not just from inside a field.
  useDismissLayer(true, onDone);

  const commit = (): void => {
    if (label.trim() !== '' && label.trim() !== credential.label) {
      renameCredential(credential.id, label);
    }
    // Re-pointing rides the replace path on purpose: a moved pointer clears what the old
    // target earned (cooldown, expiry), exactly like a fresh secret does.
    if (pointer && target.trim() !== '' && target.trim() !== credential.masked) {
      replaceSecret(credential.id, target);
    }
    onDone();
  };

  return (
    <div className="flex items-center gap-2 rounded-r3 border border-s4 bg-s2 px-3 py-2.5">
      <Field
        autoFocus
        value={label}
        onChange={setLabel}
        onCommit={commit}
        onCancel={onDone}
        placeholder="label"
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
          <Field
            value={target}
            onChange={setTarget}
            onCommit={commit}
            onCancel={onDone}
            placeholder="GEMINI_API_KEY"
            className="flex-1"
          />
        ))}
      <Button variant="quiet" disabled={label.trim() === ''} onClick={commit}>
        save
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
  const replaceSecret = useMockAuth((s) => s.replaceSecret);
  const [secret, setSecret] = useState('');

  // Escape abandons the replace from anywhere in the row, not just from inside a field.
  useDismissLayer(true, onDone);

  const commit = (): void => {
    if (secret.trim() === '') return;
    replaceSecret(credential.id, secret);
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
          placeholder="point at the config directory again…"
        />
      ) : (
        <Field
          autoFocus
          value={secret}
          onChange={setSecret}
          onCommit={commit}
          onCancel={onDone}
          placeholder={`paste the replacement ${provider.noun}…`}
          secret
          className="flex-1"
        />
      )}
      <Button variant="quiet" disabled={secret.trim() === ''} onClick={commit}>
        replace
      </Button>
      <Button variant="text" onClick={onDone}>
        esc
      </Button>
    </div>
  );
}

function Field({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  secret = false,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  placeholder: string;
  secret?: boolean;
  autoFocus?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <input
      // The row IS the interaction — it opened because you asked to add a key, so the caret
      // belongs in it. (Not a page-load autofocus.)
      autoFocus={autoFocus}
      type={secret ? 'password' : 'text'}
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit?.();
        // The field owns Escape ONLY when it has a cancel to run — swallowing it otherwise
        // strands the key (a focused dialog field would eat the dialog's own Escape).
        if (e.key === 'Escape' && onCancel !== undefined) {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={cx(
        'slip min-w-0 rounded-r2 border border-s5 bg-s1 px-2.5 py-1 font-mono text-code text-s11 outline-none placeholder:text-s7 focus:border-s7',
        className,
      )}
    />
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
      <Field
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        {...(onCommit !== undefined ? { onCommit } : {})}
        {...(onCancel !== undefined ? { onCancel } : {})}
        placeholder={placeholder}
        className="flex-1"
      />
      <Button variant="text" onClick={() => void browse()}>
        browse…
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
  const added = useMockAuth((s) => s.added);
  const addProvider = useMockAuth((s) => s.addProvider);
  const addCredential = useMockAuth((s) => s.addCredential);
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
    addProvider(picked.id);
    addCredential(picked.id, label.trim() === '' ? picked.label : label, secret);
    onAdded(picked.id);
    close();
  };

  return (
    <ModalShell open={open} onClose={close} aria-label="add provider" className="w-124">
      <AnimatePresence mode="wait" initial={false}>
        {picked === undefined ? (
          <motion.div key="catalogue" {...RISE}>
            <CapsLabel className="border-b border-s3 px-4 py-3">add provider</CapsLabel>
            <div className="max-h-100 overflow-y-auto px-4 pt-1 pb-4">
              <CapsLabel className="px-0 pt-3 pb-1.5">agent backends</CapsLabel>
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
              <CapsLabel className="px-0 pt-4 pb-1.5">tool services</CapsLabel>
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
                {picked.group === 'backend' ? 'agent backend' : 'tool service'}
              </span>
            </div>
            <div className="flex flex-col gap-4 px-4 py-4">
              <label className="flex flex-col gap-1.5 text-code text-s9">
                label
                <Field value={label} onChange={setLabel} placeholder={picked.label} />
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
                  <Field
                    autoFocus
                    value={secret}
                    onChange={setSecret}
                    onCommit={commit}
                    placeholder={
                      picked.locator === 'env-var' ? 'GEMINI_API_KEY' : `paste the ${picked.noun}…`
                    }
                    secret={picked.locator === 'key-file'}
                  />
                )}
              </label>
              <span className="text-meta leading-relaxed text-s7">{picked.hint}</span>
              <div className="flex items-center gap-2 text-code text-s8">
                <StatusDot status="idle" />
                not verified — coa never calls a provider to check a credential. It goes live on
                first use.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
              <Button variant="outline" onClick={reset}>
                back
              </Button>
              <Button variant="quiet" disabled={secret.trim() === ''} onClick={commit}>
                add {picked.noun}
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
        {already ? 'added' : LOCATOR_LABEL[provider.locator].split(' ')[0]}
      </span>
    </button>
  );
}

import { useEffect, useState } from 'react';
import { toCapViewModel, type CapViewModel } from '@coa/console-viewmodel';

export function App(): React.JSX.Element {
  const [vm, setVm] = useState<CapViewModel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    window.coa
      .getCap()
      .then((raw) => setVm(toCapViewModel(raw)))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: 16,
          maxWidth: 260,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-fg-faint)',
          }}
        >
          Cost
        </div>
        {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
        {vm && (
          <div
            style={{
              color: vm.tone === 'danger' ? 'var(--color-danger)' : 'var(--color-fg-default)',
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {vm.headline}
          </div>
        )}
        {vm && <div style={{ color: 'var(--color-fg-muted)', fontSize: 11 }}>{vm.sub}</div>}
      </div>
    </div>
  );
}

# @coa/console-kit

The workbench design system's kit: the sand-dark theme seam (`src/themes/` — a theme is one full scale
file), the structural tokens (`src/tokens.css`: type scale, radii, Slipstream motion, semantic z levels),
and the component vocabulary. Interactive mechanics ride Base UI (`@base-ui/react`) where a part exists;
the identity — geometry, ink, motion — is the kit's own.

**Design authority:** [docs/UI.md](../../docs/UI.md) (the laws + authoring rules). The living spec is the
console's own showcase surface (`apps/desktop/src/renderer/panels/ShowcasePanel.tsx`): every registered
kit member renders a specimen there, enforced by a test.

## Adding a member

Every component ships with an intent block (`<Name>.intent.ts`, registered in `src/registry.ts`) and all
of its applicable states (see UI.md's graduation checklist). `COMPONENTS.md` is generated — never edit it
by hand:

```sh
pnpm --filter @coa/console-kit gen     # regenerate the catalogue
pnpm vitest run packages/console-kit   # tests enforce catalogue byte-equality + intent validity
```

---

_Last reviewed: 2026-08-01_

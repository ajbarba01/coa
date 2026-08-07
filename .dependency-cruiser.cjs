// Asserts the SPEC §A.4 dependency arrows as hard constraints. A violation fails
// CI. When a genuinely new edge is needed it changes the SPEC map AND this ruleset
// in the same commit (the same-commit doc rule). Rules whose path patterns match
// not-yet-built packages are inert until those packages exist.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Acyclic dependency graph: the topological build order only holds if there are no cycles.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-imports-nothing',
      severity: 'error',
      comment: 'M0 (shared) is the acyclic-graph root; it imports no other workspace package.',
      from: { path: '^packages/shared/src' },
      to: { path: '^packages/(?!shared/)' },
    },
    {
      name: 'backend-isolation',
      severity: 'error',
      comment:
        'Only adapter-claude-sdk may import a backend SDK. The core calls capability ports — no which-backend branch anywhere else.',
      from: { pathNot: '^packages/adapter-claude-sdk/' },
      // (^|/) rather than ^: pnpm resolves externals through node_modules/.pnpm/<pkg>@<v>/node_modules/<pkg>,
      // so an anchored ^node_modules/ never matches a real resolved path.
      to: { path: 'node_modules/(@anthropic-ai|@ai-sdk)/|(^|/)node_modules/ai/' },
    },
    {
      name: 'packages-not-to-apps',
      severity: 'error',
      comment: 'Apps depend on libraries, never the reverse.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'backend-fan-in-is-injected',
      severity: 'error',
      comment:
        'The core (and every backend-neutral package) never imports an adapter package. Concrete backends are constructed in the app composition roots and injected through the port types in spi. The bare-specifier alternative catches an import that no longer resolves (the offending package.json dependency is gone) but would still break the build.',
      from: { path: '^packages/(core|spi|shared|loop-driver|code-intel)/src' },
      to: { path: '^packages/adapter-|^@coa/adapter-' },
    },
    {
      name: 'core-consumer-rings-no-sideways',
      severity: 'error',
      comment:
        'Inside core, only the spine (the root-level kernel/event/projection/checkpoint/idle files plus graph/, reconcile/, scope/ and wal/) is shared mutable substrate. Every other ring imports the spine + shared, never a sibling ring sideways (REPO_LAYOUT intra-core rule). Two deliberate exemptions, not listed in `from`: session/ (M8 composition — it wires the rings into a daemon) and rpc/ (M8 transport — it exposes them over JSON-RPC) are hubs that legitimately reach into many rings. workbench/ has its own narrower rule below. A genuinely new sanctioned edge changes the SPEC map AND an explicit allowance here in the same commit.',
      from: {
        path: '^packages/core/src/(auth|compiler|console|context|flags|governance|graph|models|reconcile|scope|wal)/',
      },
      to: {
        path: '^packages/core/src/(auth|compiler|console|context|flags|governance|models|rpc|session|workbench)/',
        pathNot: '^packages/core/src/$1/',
      },
    },
    {
      name: 'core-workbench-only-sanctioned-reads',
      severity: 'error',
      comment:
        'The workbench (M6) is a producer: it writes via the spine and MAY read flags/context/governance — the reads its SPEC dependencies sanction (REPO_LAYOUT intra-core rule). Everything else in core is off limits to it, and no consumer ring imports the workbench back (covered by core-consumer-rings-no-sideways).',
      from: { path: '^packages/core/src/workbench/' },
      to: { path: '^packages/core/src/(auth|compiler|console|models|rpc|session)/' },
    },
    {
      name: 'core-spine-imports-no-rings',
      severity: 'error',
      comment:
        'The spine files at the root of core/src (kernel, event, projection, checkpoint, idle) are the substrate everything else points AT — they must not know any ring above them, or producers→spine←consumers collapses into a tangle. index.ts is the package barrel and re-exports everything by design.',
      from: {
        path: '^packages/core/src/[^/]+\\.ts$',
        pathNot: '^packages/core/src/index\\.ts$',
      },
      to: {
        path: '^packages/core/src/(auth|compiler|console|context|flags|governance|models|rpc|session|workbench)/',
      },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module imported by nothing is usually dead code (or a missing wiring).',
      from: { orphan: true, pathNot: '(\\.d\\.ts$|index\\.ts$|\\.config\\.(ts|js|cjs|mjs)$)' },
      to: {},
    },
    {
      name: 'viewmodel-no-electron-react',
      severity: 'error',
      comment:
        'The pure console view-model maps daemon data to props; it never imports electron, react, or core.',
      from: { path: '^packages/console-viewmodel/src' },
      to: { path: 'node_modules/(electron|react|react-dom)/|^packages/core/' },
    },
    {
      name: 'console-ui-no-electron-core',
      severity: 'error',
      comment:
        'The kit and the conversation renderer are pure renderer-side libraries; neither imports electron or the daemon core (only react/@base-ui/lucide/react-markdown and friends).',
      from: { path: '^packages/(console-kit|console-transcript)/src' },
      to: { path: 'node_modules/electron/|^packages/core/' },
    },
    {
      name: 'kit-never-depends-on-the-transcript',
      severity: 'error',
      comment:
        'The kit is the vocabulary and the transcript is one surface built from it. The dependency runs one way; if it ever runs both, the split that keeps the kit reviewable has collapsed (docs/adr/0025).',
      from: { path: '^packages/console-kit/src' },
      to: { path: '^packages/console-transcript/' },
    },
    {
      name: 'renderer-isolation',
      severity: 'error',
      comment:
        'The sandboxed renderer must import no electron and no daemon core; only main/preload may.',
      from: { path: '^apps/desktop/src/renderer' },
      to: { path: 'node_modules/electron/|^packages/core/' },
    },
  ],
  options: {
    // node_modules is doNotFollow (NOT exclude): external modules stay in the graph as
    // endpoints so rules like backend-isolation can match edges into them, without the
    // cruiser descending into dependency internals.
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    // archive/ holds parked feature code — never compiled, linted, or imported.
    exclude: { path: '(\\.test\\.tsx?$|/dist/|(^|/)archive/)' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // 'development' first: every workspace package's exports map carries a
      // `development` condition pointing at its TypeScript source, so cross-package
      // `@coa/*` edges resolve to `packages/*/src/**` — the paths the rules above are
      // written against. Without it they resolve to dist and every cross-package rule
      // silently goes inert (test/depcruise-canary.test.ts guards this mechanism).
      conditionNames: ['development', 'import', 'types', 'node'],
    },
  },
};

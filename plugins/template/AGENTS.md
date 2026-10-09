# Working on the reference plugin

This is System Overview, the plugin every user plugin is forked from: `/plugin create` copies it
into `~/.localix/plugins/<name>` under a new identity, and the agent replaces its domain. Read the
repository root guidelines first. This directory is a Bun workspace package, not a separate Git
repository; use the parent's dependency installation and lockfile.

What a copy is made of is declared in `scaffold.json`, and every part of it is load-bearing:

- **Entry** — same path and export in every copy, body replaced: `plugin.json`, `ui/register.tsx`,
  `ui/Workspace.tsx`, `backend/index.ts`, `backend/routes.ts`.
- **Domain** — System Overview itself, deleted or rewritten by each copy. Its identifiers are the
  residue the `plugin_build` check reports, so a new one goes on `domainTokens`.
- **Frame** — everything else, kept byte for byte: `ui/usePolledSnapshot.ts` (polling and `send`),
  `ui/useStoreSnapshot.ts` (the same, re-read when the store feed nudges), `ui/useNow.ts` (a clock
  for derived values), `backend/store.ts` (durable state under `ctx.dataDir`),
  `backend/store-feed.ts` and `shared/store-feed.ts` (the nudge after a store write),
  `shared/schema.ts`. The frame never imports a domain module — replacing the domain must never
  break it, and `scripts/plugin-kit.test.ts` fails the moment it does.
- **Patterns** — the domain files the agent reads before replacing them, each at an anchor the file
  contains. They are how a copy learns an acting tool, a state-changing route, a form driven by
  `send` and a value derived with `useNow`; keep them the best example of each in the repository.

House rules the copies inherit from here:

- Act through `usePolledSnapshot`: `send()` for every action, whose route answers with the new
  state. Never a second copy of the state, a second timer or a `visibilitychange` listener.
- Changes are pushed, not polled. State the agent's tool also writes (through `openJsonStore`) is
  read with `useStoreSnapshot` and the backend's `createStoreFeed`, so the view hears the write. Any
  other live data is a `wsFrames` entry the view follows with `createRealtimeFeed` /
  `useRealtimeFeed` (`@localixai/plugin-sdk/ui/realtime-feed`); workspace files with
  `usePluginWorkspaceChanges`; a backend watching files uses `ctx.watchPath`, never `node:fs.watch`.
  A healthy store or realtime feed has no periodic read; fallback polling runs only while the signal
  is unavailable. Gauges with no write behind them — CPU, memory — use their own cadence.
- Build every control from the host kit, `@localixai/kit/<id>`, and colour with host tokens; the
  `plugin_build` style step and `scripts/ui-token-drift-guard.test.ts` apply the same rules. Never
  import `@/…`: the UI is built into its own artifact, and that build refuses host internals.
- Keep what the user creates in `openJsonStore` under `ctx.dataDir`, and anything that runs while
  the pane is hidden as timestamps in the backend, where the tools reach it.
- Publish the visible snapshot as message context and clear it when the view is inactive.
- Keep application code independent of `preview/`, which only this repository has.

Choose checks for the changed contract. Run a focused test under this plugin; use its `type-check`
or `type-check:tests` script when static evidence is needed. Changes to the scaffold frame also need
`bun test scripts/plugin-kit.test.ts` from the repository root: it builds and checks a copy from a
staged kit. Full builds and repository gates belong to CI. Documentation-only edits need
documentation validation, not a runtime build.

For visible changes, inspect `plugin:template` in the running app at narrow and wide widths and
maintain the owning optional capture scenario under the repository screenshot workflow.

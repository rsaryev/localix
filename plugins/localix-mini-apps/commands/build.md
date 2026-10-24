---
description: Build a Localix mini app and load the change
argument-hint: <name>
---

Build the Localix mini app named `$ARGUMENTS`. If no name was given, ask which app.

## Inside Localix

When the `mini_app_build` tool is available, call it with `name` set to `$ARGUMENTS` and no
`description` (a description creates a new app). It builds, tests and reloads the app; the workbench
swaps the new interface in place, with no restart. A failed check publishes nothing new and keeps
the previous build, but your source edits remain: fix what it reports and call it again.

When the `browser` tool is available, open `mini-app:<name>`, take a screenshot and exercise the
interface. Otherwise report that visual and interaction checks were not run.

If the person edited the files themselves, they can run `/mini-app reload`, which rebuilds their own
mini apps and reloads every mini app.

## In a checkout of the Localix repository

In `mini-apps/$ARGUMENTS`:

```bash
bun run build
```

It type-checks, builds the UI module and bundles the Bun backend. To try the app standalone,
`bun run dev` starts the backend and a hot-reloading preview. A running Localix in development
builds its catalog from the checkout, so a change under `mini-apps/` is installed without a release.

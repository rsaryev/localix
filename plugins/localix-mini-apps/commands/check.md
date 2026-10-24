---
description: Run a Localix mini app's checks and tests
argument-hint: <name>
---

Check the Localix mini app named `$ARGUMENTS`. If no name was given, ask which app.

## Inside Localix

When the `mini_app_build` tool is available, call it with `name` set to `$ARGUMENTS` and no
`description`. It checks template residue, style, routes, message context, the backend and UI
builds, types and the app's tests, and publishes only when every check passes. Fix each failure it
reports and call it again. Its **store media** step reports icon, screenshot and tag problems
without failing the build; fix them before packing.

If the person edited the files themselves, `/mini-app reload` rebuilds their mini apps and prints
the check report of a failed build.

## In a checkout of the Localix repository

From the repository root:

```bash
bun test mini-apps/$ARGUMENTS
```

Then, in `mini-apps/$ARGUMENTS`:

```bash
bun run test
bun run type-check:tests
```

Report which checks ran and what failed. A test step with no test files proves nothing about the
feature; say so if the app has none.

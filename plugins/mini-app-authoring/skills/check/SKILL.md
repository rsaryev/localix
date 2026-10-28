---
name: check
description:
  Check a Localix mini app the way Localix judges it — template leftovers, house style, routes,
  store media, message bindings, manifest, backend and UI builds, types and its tests — and fix what
  fails. Use after changing a mini app, or when the person asks whether one is ready.
argument-hint: '[mini app folder]'
allowed-tools: Bash(mini-app:*)
---

# Check a mini app

Run the checks on the folder the person named, or the current one:

```bash
mini-app check $ARGUMENTS
```

The report lists every step with `ok` or `FAILED`, and each problem on one line with its
`file:line`. Fix every problem, then run the check again; repeat until every step passes. Never
silence a check by deleting a test or loosening a rule.

- **template residue** names what a copy still carries of the reference app: rename those files and
  identifiers after what they now hold, and draw the app's own icon with `mini-app icon`.
- **store media** failing does not stop a build or an install, but a catalog refuses an app without
  a valid icon. Fix it before publishing.
- **types** reads the `tsconfig.json` the check writes; the editor's diagnostics read the same one.
- **tests** runs `bun test` with the kit's modules preloaded. A mini app without tests passes this
  step without proving anything: write tests for what the app does.

`mini-app check --json` prints the report as JSON for a script.

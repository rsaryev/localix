---
name: install
description:
  Build a Localix mini app's package and install it into Localix, or rebuild and swap in a new
  version of one already installed. Use when the person wants to run or try their mini app in
  Localix, or after changing one.
argument-hint: '[mini app folder]'
allowed-tools: Bash(mini-app:*)
---

# Install a mini app into Localix

```bash
mini-app install $ARGUMENTS
```

This checks the app, writes its package to `<folder>/dist/package`, and hands it to the running
Localix, which validates it, installs it as the person's own app, switches it on and swaps it into
any open view. When Localix is installed but not running, the command opens it first.

- When the check fails, nothing is installed: fix what the report lists (see the `check` skill) and
  run it again.
- When Localix is not installed, say so and offer `/mini-app-authoring:get-localix`. Until then,
  `mini-app build $ARGUMENTS` leaves the package ready.
- Localix refusing the package prints its reason. Fix the app; never copy files into Localix's
  folders by hand.

Afterwards tell the person the app is in Localix's workspace overflow menu. Inside Localix, look at
it with the `Browser` tool at `mini-app:<name>` when that tool is available, and say so when it is
not.

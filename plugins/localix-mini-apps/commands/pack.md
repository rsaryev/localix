---
description: Pack a Localix mini app into a catalog
argument-hint: <name>
---

Pack the Localix mini app named `$ARGUMENTS` into a catalog. If no name was given, ask which app,
and ask who the publisher is.

Before packing, make sure `mini-app.json` names a valid `icon` (packing refuses a missing or invalid
one), and that `version` is new if this is an update.

## An app Localix built

Inside Localix, the app lives in `~/.localix/mini-apps/<name>`. Packing needs a checkout of the
Localix repository; Localix itself offers no packing command. Run `/mini-app reload` first (or call
`mini_app_build` with the `name`) so its backend and screens are built, then from the checkout:

```bash
bun run pack:mini-apps --source ~/.localix/mini-apps/$ARGUMENTS --publisher "<you>"
```

## An app in a checkout of the Localix repository

From the repository root:

```bash
bun run pack:mini-apps --only $ARGUMENTS --publisher "<you>" --out dist/catalog
```

It builds the app exactly as a Localix release does. `--only` takes a comma-separated list.

## Result

The output folder holds `mini-app-catalog.json`, one `<name>-<version>-<hash>.tar.gz` archive per
app, and the icon, screenshots and README beside it, each named with the start of its hash. Do not
edit the catalog by hand. Publish it with `/localix-mini-apps:publish`.

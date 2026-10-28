---
name: publish
description:
  Share a Localix mini app with other people — pack it into a catalog, host the catalog, and give
  them the address to add in Localix — and ship updates to it. Use when the person wants to share,
  publish, release or update a mini app for others.
argument-hint: '[mini app folder]'
allowed-tools: Bash(mini-app:*)
---

# Publish a mini app

People install shared mini apps from a **catalog**: `mini-app-catalog.json` with one archive per app
and its store media, all in one folder on any HTTPS host. Localix lists every catalog a person has
added in its mini app store.

## Steps

1. For an update, raise `version` in `mini-app.json` first. Installed copies update by version
   alone: new content under the same version reaches no one.
2. Pack it:

   ```bash
   mini-app pack $ARGUMENTS --publisher "<name people see>" --out <catalog folder>
   ```

   It checks and builds the app, then adds it to the catalog in the output folder (default
   `<app>/dist/catalog`), replacing an earlier version of the same app. Packing several apps into
   one folder makes one catalog of all of them. Packing refuses an app without a valid icon.

3. Upload every file in the catalog folder to one place; archive and media addresses are relative to
   the catalog. On GitHub, **ask the person before creating the release**, then:

   ```bash
   gh release create <name>-v<version> <catalog folder>/*
   ```

   The catalog's address is then
   `https://github.com/<owner>/<repo>/releases/latest/download/mini-app-catalog.json`, and `latest`
   follows the newest release.

4. Give the person the address to share. Others add it in Localix's mini app store → catalog menu →
   **Add catalog…**, with `/mini-app catalog add <address>`, or with a link that opens that dialog
   filled in: `localix://ui/work-item/mini-app-store/add-catalog?url=<encoded address>`.

## What to tell the person

- A catalog's publisher shows as unverified; only the hosted Localix catalog verifies publishers.
  Installing from an unverified publisher asks **Install anyway?**.
- Installed copies take a newer version within six hours, or at once with Update.
- Raising `apiVersion` in `mini-app.json` makes an older Localix list the app as needing an update.
- `mini-app validate <archive.tar.gz>` checks a packed archive the way Localix will.

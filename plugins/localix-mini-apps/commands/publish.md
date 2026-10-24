---
description: Publish a Localix mini app's catalog and ship updates
argument-hint: <name>
---

Publish the Localix mini app named `$ARGUMENTS`. If no name was given, ask which app.

## Steps

1. Pack it first with `/localix-mini-apps:pack $ARGUMENTS`. For an update, raise `version` in
   `mini-app.json` before packing: an app is updated by `version` alone, so new content under the
   same version reaches no one who has it installed.
2. Upload every file in the output folder to one place: a GitHub release, a site, any HTTPS host.
   Archive and media URLs are relative to the catalog, so they must stay together. On GitHub, with
   the person's confirmation:

   ```bash
   gh release create $ARGUMENTS-v<version> dist/catalog/*
   ```

   The catalog's address is then
   `https://github.com/<owner>/<repo>/releases/latest/download/mini-app-catalog.json`, and `latest`
   follows the newest release.

3. Give the person the catalog URL to share. People add it from the store's catalog menu → **Add
   catalog…**, or with a link that opens that dialog filled in:
   `localix://ui/work-item/mini-app-store/add-catalog?url=<encoded address>`.

## Inside Localix

The person can add the catalog with `/mini-app catalog add <url>`, see catalogs with
`/mini-app catalog list` and remove one with `/mini-app catalog remove <url>`. Installed copies take
a newer version within six hours, or at once with Update.

## What to tell the person

- Publishers are shown as unverified; only the hosted Localix catalog marks publishers as verified
  and features apps. Installing from an unverified publisher asks **Install anyway?**.
- Raising `apiVersion` makes older Localix list the app as needing a newer version.
- The README is shown as Markdown; its HTML is not shown.

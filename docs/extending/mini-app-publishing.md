# Publish a mini app

A mini app reaches other people through a catalog: one `mini-app-catalog.json` that lists apps, with
one archive per app beside it. Localix publishes its own catalog with every release. Anyone can
publish theirs the same way, from a fork of the template, and people add it to their store.

## Terminology

| Term      | Meaning                                                                      | Boundary                                                              |
| --------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Catalog   | `mini-app-catalog.json`: the apps on offer and where each archive is         | Archive URLs are relative to it, so the two move together.            |
| Archive   | A gzip tarball whose root is the app's built folder (`mini-app.json` on top) | Holds only files: no symlinks, no `node_modules`, no install records. |
| Publisher | Who the catalog says made the app                                            | Shown as verified only in the hosted Localix catalog.                 |
| Version   | `version` in `mini-app.json`                                                 | The store offers an update when it differs from the installed one.    |

## What you can do

| Task                      | Do this                                                                              | Boundary                                                            |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Start an app              | Copy `mini-apps/template` to `mini-apps/<name>` and rename it                        | Or `/mini-app create`, which forks the same template.               |
| Pack it                   | `bun run pack:mini-apps --only <name> --publisher "<you>"`                           | Builds it exactly as a Localix release does.                        |
| Pack an app Localix built | `bun run pack:mini-apps --source ~/.localix/mini-apps/<name> --publisher "<you>"`    | Run `/mini-app reload` first, so its backend and screens are built. |
| Host the catalog          | Upload everything in the output folder to one place: a GitHub release, a site        | Any HTTPS host, or a folder read as `file://`.                      |
| Add a catalog to Localix  | **Catalogs** in the store, or Settings → Mini apps → **Catalogs**: paste its address | Its publishers are shown as unverified.                             |
| Ship an update            | Raise `version`, pack again, replace the hosted files                                | Installed copies update within six hours, or at once with Update.   |
| Require a newer Localix   | Raise `apiVersion` in `mini-app.json`                                                | Older Localix lists the app as needing a newer version.             |

## How it works

### The catalog

```json
{
  "schema": 1,
  "apps": [
    {
      "name": "notes",
      "displayName": "Notes",
      "description": "Notes beside every chat.",
      "category": "utilities",
      "version": "1.2.0",
      "apiVersion": 1,
      "publisher": { "name": "Ada", "verified": false },
      "archive": {
        "url": "notes-1.2.0-3fa1c2d4e5b6.tar.gz",
        "bytes": 148167,
        "sha256": "3fa1c2d4e5b6…"
      }
    }
  ]
}
```

The pack command writes the catalog. Editing it by hand is not needed. Each entry pins its archive
by size and sha256, and the archive's file name carries the start of its hash. An app whose name,
version or archive does not read is left out, and the rest of the catalog still loads.

### Installing and updating

The store downloads an archive with progress, and resumes an interrupted download. It refuses the
archive when its size or sha256 differs from the catalog's. It then unpacks the archive into a
folder beside the installed copy, refusing any path that leaves the folder and anything larger than
512 MB. It checks that `mini-app.json` names the promised app and version, and swaps the folder in
with one rename. A failure at any step keeps the version that was installed.

Apps a catalog installed take its newer versions a minute after Localix starts and every six hours.
A folder you made yourself under `~/.localix/mini-apps/` is never replaced by a catalog's app of the
same name; installing one says the name is taken.

### Trust

Installing an app from an unverified publisher asks **Install anyway?** in the store. Choosing it is
the yes that lets its backend run, as for any mini app you allow. A mini app's backend runs as
trusted local code: a catalog decides where an app comes from, not what it may do.

### Hosting on GitHub

A release is enough. Pack, then upload the folder's files as the release's assets:

```bash
bun run pack:mini-apps --only notes --publisher "Ada" --out dist/catalog
gh release create notes-v1.2.0 dist/catalog/*
```

People then add `https://github.com/<you>/<repo>/releases/latest/download/mini-app-catalog.json`
under **Catalogs** in the store. `latest` follows your newest release, so the next release is the
next update.

## Limits

- Only the hosted Localix catalog marks publishers as verified.
- An app is updated by `version` alone. New content under the same version reaches no one who has it
  installed.

## Related guides

- [Build a mini app](mini-apps.md)
- [Mini apps](../features/mini-apps.md)
- [Build with the agent](build-with-the-agent.md)

## Source of truth

- [The pack command](https://github.com/rsaryev/localix/blob/main/scripts/pack-mini-apps.mjs)
- [The catalog it writes](https://github.com/rsaryev/localix/blob/main/scripts/lib/mini-app-catalog.mjs)
- [Reading a catalog](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/catalog-feed.ts)
- [Installing an archive](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/store-install.ts)

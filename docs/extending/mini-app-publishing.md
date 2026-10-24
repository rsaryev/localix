# Publish a mini app

A mini app reaches other people through a catalog: one `mini-app-catalog.json` that lists apps, with
one archive per app beside it and the app's icon, screenshots and README next to them. Localix
publishes its own catalog with every release. Anyone can publish theirs the same way, from a fork of
the template, and people add it to their store.

## Terminology

| Term        | Meaning                                                                      | Boundary                                                              |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Catalog     | `mini-app-catalog.json`: the apps on offer and where each archive is         | Archive and media URLs are relative to it, so they move together.     |
| Archive     | A gzip tarball whose root is the app's built folder (`mini-app.json` on top) | Holds only files: no symlinks, no `node_modules`, no install records. |
| Store media | The app's icon, screenshots and README, published beside the archive         | Each pinned by size and sha256 like the archive.                      |
| Publisher   | Who the catalog says made the app                                            | Shown as verified only in the hosted Localix catalog.                 |
| Version     | `version` in `mini-app.json`                                                 | The store offers an update when it differs from the installed one.    |

## What you can do

| Task                      | Do this                                                                           | Boundary                                                                |
| ------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Start an app              | Copy `mini-apps/template` to `mini-apps/<name>` and rename it                     | Or `/mini-app create`, which forks the same template.                   |
| Give it an icon           | Put `icon.svg` in the app and set `"icon": "./icon.svg"`                          | Required to publish; see [Icon and screenshots](#icon-and-screenshots). |
| Show it in the store      | Add `screenshots`, `tags` and `homepage` to `mini-app.json`, and a `README.md`    | Optional; the README becomes the store page's About.                    |
| Pack it                   | `bun run pack:mini-apps --only <name> --publisher "<you>"`                        | Builds it exactly as a Localix release does; refuses a missing icon.    |
| Pack an app Localix built | `bun run pack:mini-apps --source ~/.localix/mini-apps/<name> --publisher "<you>"` | Run `/mini-app reload` first, so its backend and screens are built.     |
| Host the catalog          | Upload everything in the output folder to one place: a GitHub release, a site     | Any HTTPS host, or a folder read as `file://`.                          |
| Add a catalog to Localix  | The store's catalog menu → **Add catalog…**, or `/mini-app catalog add <url>`     | Its publishers are shown as unverified.                                 |
| Link people to it         | Share `localix://ui/work-item/mini-app-store/add-catalog?url=<encoded address>`   | Opens the Add catalog dialog filled in; nothing is added until Add.     |
| Ship an update            | Raise `version`, pack again, replace the hosted files                             | Installed copies update within six hours, or at once with Update.       |
| Require a newer Localix   | Raise `apiVersion` in `mini-app.json`                                             | Older Localix lists the app as needing a newer version.                 |

## How it works

### Icon and screenshots

The store, Settings → Mini apps and the Mac app an app can become all show the app's own icon, so an
app is recognisable wherever it appears. Its rail button keeps the line glyph its screen registers,
drawn like every other rail button. `mini-app.json` names the files by paths inside the app's
folder:

```json
{
  "name": "notes",
  "version": "1.2.0",
  "description": "Notes beside every chat.",
  "category": "utilities",
  "icon": "./icon.svg",
  "screenshots": [
    { "path": "./screenshots/editor.png", "caption": "A note beside its chat" },
    { "path": "./screenshots/search.png" }
  ],
  "tags": ["notes", "writing"],
  "homepage": "https://example.com/notes"
}
```

| Field         | Rule                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `icon`        | Required to publish. `.svg` (recommended), `.png` or `.webp` of at least 512×512, or `.ico`; square; at most 256 KB; an SVG holds no script.           |
| `screenshots` | At most 10, each `{ path, caption? }`: `.png`, `.jpg`, `.jpeg` or `.webp`, at most 5 MB. The store shows the file you publish; it is never downscaled. |
| `tags`        | At most 8 lower-case words joined by dashes (`board-game`); the store filters and searches by them.                                                    |
| `homepage`    | An `https://` address, linked from the store page's Details.                                                                                           |

`mini_app_build` and `/mini-app reload` check these in their **store media** step and say what to
fix; a problem there does not hold back the build, because the app runs without an icon. Packing
refuses an app whose icon is missing or not a valid icon. Screenshots are published beside the
archive, not in it, so installing an app does not download them.

### The icon standard

The first-party apps share one look: Localix's Mac-app tile with the app's glyph in light ink. On a
1024 grid the tile is 896 wide with a 64 margin, corner radius 196, filled top to bottom from
`#121215` to `#09090b`; the glyph is about 400 wide, drawn at a fine stroke in `#e7e6e6`. Start from
this and replace the inner `<svg>` with your glyph:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="fall" x1="0" y1="64" x2="0" y2="960" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#121215"/>
      <stop offset="1" stop-color="#09090b"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="196" fill="url(#fall)"/>
  <svg x="312" y="312" width="400" height="400" viewBox="0 0 24 24" fill="none"
       stroke="#e7e6e6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 6h16M4 12h16M4 18h10"/>
  </svg>
</svg>
```

Any square picture is accepted; the standard only keeps a catalog's apps looking like one family.

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
      "icon": {
        "url": "notes-1.2.0-icon-9adc7cb124e4.svg",
        "bytes": 700,
        "sha256": "9adc…",
        "type": "image/svg+xml"
      },
      "screenshots": [
        {
          "url": "notes-1.2.0-screenshot-1-7685be3cfb3c.png",
          "bytes": 745719,
          "sha256": "7685…",
          "type": "image/png",
          "caption": "A note beside its chat"
        }
      ],
      "readme": { "url": "notes-1.2.0-readme-fb386f3624bc.md", "bytes": 4914, "sha256": "fb38…" },
      "tags": ["notes", "writing"],
      "homepage": "https://example.com/notes",
      "license": "MIT",
      "author": "Ada",
      "surfaces": ["agent", "workbench"],
      "commands": ["new"],
      "archive": {
        "url": "notes-1.2.0-3fa1c2d4e5b6.tar.gz",
        "bytes": 148167,
        "sha256": "3fa1c2d4e5b6…"
      }
    }
  ]
}
```

The pack command writes the catalog and the media files, each named with the start of its hash.
Editing it by hand is not needed. Every field after `publisher` but `archive` is optional and still
schema 1: a reader that does not know one ignores it, and one that does not read is dropped alone,
so a bad icon never hides its app.

An app whose name, version or archive does not read is left out, and the rest of the catalog still
loads. `featured: true` puts an app in the store's Featured group, and `recommended: true` has a new
installation install it on its own, but both only in the hosted Localix catalog; the Localix release
sets them from `mini-apps/catalog-picks.json`.

### How the store shows media

The store never hands a catalog's addresses to the page. It serves every file through the API
(`/rpc/mini-apps/store/media/<app>/icon`, `…/screenshot/<n>`): a catalog's file is fetched once,
refused unless its size and sha256 match the catalog, kept under `~/.localix/cache/mini-app-store`,
and checked to be the image it claims. Responses carry `X-Content-Type-Options: nosniff`, and an SVG
a `Content-Security-Policy` that loads and runs nothing; the page shows an SVG only as an image. A
media address must be HTTPS, or a file beside a catalog read from a folder.

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

### Adding a catalog

Adding a catalog reads it first. The store's **Add catalog…** dialog shows its publishers, how many
apps it holds and their first icons, and adds it only when the person chooses **Add**;
`/mini-app catalog add <url>` replies with the same before keeping it. `/mini-app catalog list`
shows every catalog with its app count, and `/mini-app catalog remove <url>` removes one you added.

A link such as
`localix://ui/work-item/mini-app-store/add-catalog?url=https%3A%2F%2Fgithub.com%2Fada%2Fnotes%2Freleases%2Flatest%2Fdownload%2Fmini-app-catalog.json`
opens the store with that dialog filled in, from a chat or from outside the app.

### Hosting on GitHub

A release is enough. Pack, then upload the folder's files as the release's assets:

```bash
bun run pack:mini-apps --only notes --publisher "Ada" --out dist/catalog
gh release create notes-v1.2.0 dist/catalog/*
```

People then add `https://github.com/<you>/<repo>/releases/latest/download/mini-app-catalog.json`
from the store's catalog menu. `latest` follows your newest release, so the next release is the next
update.

## Limits

- Only the hosted Localix catalog marks publishers as verified and features apps.
- An app is updated by `version` alone. New content under the same version reaches no one who has it
  installed.
- A README's HTML is not shown; write it in Markdown. Images it links by a relative path show their
  alt text.

## Related guides

- [Build a mini app](mini-apps.md)
- [Mini apps](../features/mini-apps.md)
- [Build with the agent](build-with-the-agent.md)

## Source of truth

- [The pack command](https://github.com/rsaryev/localix/blob/main/scripts/pack-mini-apps.mjs)
- [The catalog it writes](https://github.com/rsaryev/localix/blob/main/scripts/lib/mini-app-catalog.mjs)
- [The media rules](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/manifest/media.ts)
- [Reading a catalog](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/catalog-feed.ts)
- [Serving store media](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/store-media.ts)
- [Installing an archive](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/store-install.ts)

# Publish a mini app

A mini app reaches other people through a catalog: one `mini-app-catalog.json` that lists apps, with
one archive per app beside it and the app's icon, screenshots and README next to them. The Localix
core hosts no catalog: the [Localix marketplace](https://github.com/rsaryev/localix-marketplace)
publishes its own with each of its releases. Anyone can publish theirs the same way, from a copy of
the authoring plugin's template or with the [plugin](build-with-the-agent.md) itself, and people add
it to their store.

## Terminology

| Term        | Meaning                                                                      | Boundary                                                              |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Catalog     | `mini-app-catalog.json`: the apps on offer and where each archive is         | Archive and media URLs are relative to it, so they move together.     |
| Archive     | A gzip tarball whose root is the app's built folder (`mini-app.json` on top) | Holds only files: no symlinks, no `node_modules`, no install records. |
| Store media | The app's icon, screenshots and README, published beside the archive         | Each pinned by size and sha256 like the archive.                      |
| Publisher   | Who the catalog says made the app                                            | Shown as verified only in the Localix marketplace's catalog.          |
| Version     | `version` in `mini-app.json`                                                 | The store offers an update when it differs from the installed one.    |

## What you can do

| Task                     | Do this                                                                                              | Boundary                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Start an app             | The authoring plugin's `create` command, with what it should do                                      | It forks the plugin's Daily Log template; copy that template to do it by hand.             |
| Give it an icon          | `mini-app icon --glyph '<path d="…"/>'`, or put `icon.svg` in the app and set `"icon": "./icon.svg"` | Required to publish; see [Icon and screenshots](#icon-and-screenshots).                    |
| Show it in the store     | Add `screenshots`, `tags` and `homepage` to `mini-app.json`, and a `README.md`                       | Optional; the README becomes the store page's About.                                       |
| Pack it                  | `mini-app pack <folder> --publisher "<you>"` (the authoring plugin)                                  | Checks and builds it first, and refuses a missing icon; or the plugin's `publish` command. |
| Release it from GitHub   | `mini-app ci <folder> --publisher "<you>"`, push, then tag `v<version>`                              | The workflow checks and packs it; see [Hosting on GitHub](#hosting-on-github).             |
| Host the catalog         | Upload everything in the output folder to one place: a GitHub release, a site                        | Any HTTPS host, or a folder read as `file://`.                                             |
| Add a catalog to Localix | Store → **Sources** → **Add source…**, or `/mini-app catalog add <url>`                              | Its publishers are shown as unverified.                                                    |
| Link people to it        | Share `localix://ui/work-item/mini-app-store/add-catalog?url=<encoded address>`                      | Opens the Store's add dialog filled in; nothing is added until Add.                        |
| Ship an update           | Raise `version`, pack again, replace the hosted files                                                | Installed copies update within six hours, or at once with Update.                          |
| Require a newer Localix  | Raise `apiVersion` in `mini-app.json`                                                                | Older Localix lists the app as needing a newer version.                                    |

## How it works

### Icon and screenshots

The store, the Store (Mini apps) and the Mac app an app can become all show the app's own icon, so
an app is recognisable wherever it appears. Its rail button keeps the line glyph its screen
registers, drawn like every other rail button. `mini-app.json` names the files by paths inside the
app's folder:

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

| Field         | Rule                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon`        | Required to publish. `.svg` (recommended), `.png` or `.webp` of at least 512×512, or `.ico`; square; at most 256 KB; an SVG holds no script.                                                 |
| `screenshots` | At most 10, each `{ path, caption? }`: `.png`, `.jpg`, `.jpeg` or `.webp`, at most 5 MB. The store shows the file you publish; it is never downscaled.                                       |
| `tags`        | At most 8 lower-case words joined by dashes (`board-game`); the store filters and searches by them.                                                                                          |
| `homepage`    | An `https://` address, linked from the store page's Details. Without one, the page links the `repository` it names (`git@github.com:you/notes.git` reads as `https://github.com/you/notes`). |

`mini-app check` checks these in its **store media** step and says what to fix; a problem there does
not hold back the build, because the app runs without an icon. Packing refuses an app whose icon is
missing or not a valid icon. Screenshots are published beside the archive, not in it, so installing
an app does not download them.

### The icon standard

The Localix marketplace's apps share one look: Localix's Mac-app tile with the app's glyph in light
ink. On a 1024 grid the tile is 896 wide with a 64 margin, corner radius 196, filled top to bottom
from `#121215` to `#09090b`; the glyph is about 400 wide, drawn at a fine stroke in `#e7e6e6`. Start
from this and replace the inner `<svg>` with your glyph:

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

The authoring plugin draws this tile for you: `mini-app icon [folder] --glyph '<path d="…"/>'` puts
a 24×24 glyph (or the path to a 24×24 `.svg` file) on it in `icon.svg`, in `#e7e6e6` unless
`--tint #hex` names another ink, and sets `"icon": "./icon.svg"` when the manifest had none. A copy
of the template keeps the Daily Log icon until you do, and `mini-app check` reports it.

### The catalog

A catalog is one JSON file in the shape of a Claude Code `marketplace.json`: who owns it, Localix's
picks under `metadata.localix`, and the apps, each with a `source` that says where it is. The pack
command writes it, with the archives and media beside it, each named with the start of its hash;
editing it by hand is not needed.

```json
{
  "schema": 2,
  "name": "notes",
  "owner": { "name": "Ada" },
  "apps": [
    {
      "name": "notes",
      "displayName": "Notes",
      "description": "Notes beside every chat.",
      "category": "utilities",
      "version": "1.2.0",
      "apiVersion": 2,
      "source": {
        "source": "archive",
        "url": "notes-1.2.0-3fa1c2d4e5b6.tar.gz",
        "bytes": 148167,
        "sha256": "3fa1c2d4e5b6…"
      },
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
      "homepage": "https://github.com/ada/notes",
      "license": "MIT",
      "author": { "name": "Ada" },
      "surfaces": ["agent", "workbench"],
      "commands": ["new"]
    }
  ]
}
```

An app's `source` is one of:

| `source`  | Fields                   | Meaning                                                            |
| --------- | ------------------------ | ------------------------------------------------------------------ |
| `archive` | `url`, `bytes`, `sha256` | The built app beside the catalog. It needs a `version`.            |
| `github`  | `repo`                   | The app in the catalog that repository's latest release publishes. |
| `url`     | `url`                    | The app in the catalog at that HTTPS address.                      |

An `archive` app is published by the catalog's `owner`. A `github` or `url` app is a link: the app
is read from its own catalog, which says what it is, signs it with its own key and is where it
installs and updates from. What the linking catalog says about it (a `description`, a `category`, a
`homepage`) fills in only what its own catalog leaves out, as Claude Code merges a marketplace entry
with the plugin's own manifest. A link is followed once: links in the linked catalog are not. This
is how [Localix Community](#localix-community) lists apps.

Every field but `name`, `source` and an archive app's `version` is optional; one that does not read
is dropped alone, so a bad icon never hides its app, and an app that does not read is left out while
the rest of the catalog still loads. Localix still reads schema 1, the earlier flat list of built
apps.

`metadata.localix` holds the Localix marketplace's picks, read in its catalog only:

```json
{
  "metadata": {
    "localix": {
      "featured": ["notes"],
      "recommended": ["notes"],
      "suits": { "notes": { "files": ["*.md"], "dependencies": [] } },
      "collections": [
        { "id": "write", "title": "Write with the agent", "style": "row", "items": ["notes"] }
      ]
    }
  }
}
```

`featured` puts an app in Discover's featured carousel and its rows, `recommended` has a new
installation install it on its own, and `suits` says what an app is for (file names where `*` stands
for any characters, and packages a project depends on), so the Store recommends it when one of them
is open or in the project. `collections` are Discover's rows, each with an `id`, a `title`, a
`subtitle`, a `style` (`row` or `grid`) and its `items`: an app's name, or `<kind>:<id>` for another
kind of package, such as `plugin:neon@claude-plugins-official`.

A marketplace of several apps keeps the same file in its repository as `.mini-app/marketplace.json`,
with each app's `source` the path of its folder (`"./mini-apps/notes"`);
`mini-app marketplace build` packs every one and writes the catalog with `archive` sources.

### Localix Community

[Localix Community](https://github.com/rsaryev/localix-community) lists plugins and mini apps that
people publish in their own repositories. It holds no code: its `.mini-app/marketplace.json` links
each mini app to its author's catalog, and its `.claude-plugin/marketplace.json` names each plugin's
repository. Localix reads it from the start, under the name **Localix Community**. Localix does not
vouch for what it lists: its publishers are unverified, installing asks first, its picks never reach
Discover, and the Localix catalog keeps its own names. Each app is signed, or not, by its author,
and updates as any app from that author's catalog would.

To list an app, publish it (`/mini-app-authoring:publish`), then open a pull request that adds an
entry to its `.mini-app/marketplace.json`:

```json
{
  "name": "notes",
  "description": "Notes beside every chat.",
  "category": "utilities",
  "source": { "source": "github", "repo": "ada/notes" },
  "homepage": "https://github.com/ada/notes"
}
```

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

Apps from a signed catalog take its newer versions on their own, a minute after Localix starts and
every six hours, unless you untick **Update automatically** in the **⋯** menu on the app's Store
page. Apps from an unsigned catalog are never updated behind your back: the Store offers the newer
version and installs it when you choose **Update**. An app updates only from the catalog it was
installed from: another catalog that lists the same name lists someone else's app. A folder you made
yourself under `~/.localix/mini-apps/` is never replaced by a catalog's app of the same name;
installing one says the name is taken.

### Trust

Installing an app from an unverified publisher asks first in the Store, in a sheet that says what
would run. Choosing **Install** is the yes that lets its backend run, as for any mini app you allow.
A mini app's backend runs as trusted local code: a catalog decides where an app comes from, not what
it may do.

### Signing

A catalog can be signed: beside `mini-app-catalog.json` sits `mini-app-catalog.json.sig`, an Ed25519
signature of the catalog file's exact bytes and the public key that made it.

```json
{
  "schema": 1,
  "algorithm": "ed25519",
  "key": "<32 bytes, base64>",
  "signature": "<64 bytes, base64>"
}
```

A signature proves who wrote a catalog only against a key known from before, so Localix keeps one
per catalog: the Localix marketplace's key is built into Localix, and a catalog you add keeps the
key it was signed with when you added it (or at its first signed read, for one added unsigned). The
Store shows each app as **Signed**, **Not signed** or **Signature changed**:

- **Signed**: the catalog's signature holds for the kept key. Its apps update on their own.
- **Not signed**: no key is kept for the catalog. Its apps install and update when you ask.
- **Signature changed**: the catalog is signed with another key, is no longer signed, or its
  signature does not hold. Nothing is installed or updated from it. If the publisher moved to a new
  key, remove the catalog and add it again to keep the new one.

### Adding a catalog

Adding a catalog reads it first. The store's **Add catalog…** dialog shows its publishers, how many
apps it holds and their first icons, and adds it only when the person chooses **Add**;
`/mini-app catalog add <url>` replies with the same before keeping it. `/mini-app catalog list`
shows every catalog with its app count, and `/mini-app catalog remove <url>` removes one you added.

A link such as
`localix://ui/work-item/mini-app-store/add-catalog?url=https%3A%2F%2Fgithub.com%2Fada%2Fnotes%2Freleases%2Flatest%2Fdownload%2Fmini-app-catalog.json`
opens the store with that dialog filled in, from a chat or from outside the app.

### Hosting on GitHub

Keep the app's source in its own repository and let GitHub Actions build each release. `mini-app ci`
writes `.github/workflows/mini-app.yml`, keeps what the checks generate (`tsconfig.json`, `KIT.md`,
`dist/`) out of git, and records the publisher as `author`:

```bash
mini-app ci notes --publisher "Ada"
git -C notes init -b main && git -C notes add -A && git -C notes commit -m "Release v1.2.0"
gh repo create notes --public --source notes --push
git -C notes tag v1.2.0 && git -C notes push origin v1.2.0
```

The workflow checks every push and pull request. On a tag that matches `version` in `mini-app.json`
it packs the catalog and attaches it to a GitHub release; a tag that does not match fails the run.
It builds with the toolchain and kit of the Localix release the app was made with; run `mini-app ci`
again after updating Localix. The plugin's `publish` command does all of this, updates included.

Without the workflow, pack on your computer and upload the folder's files as a release's assets:
`mini-app pack notes --publisher "Ada" --out dist/catalog`, then
`gh release create v1.2.0 dist/catalog/*`.

The Localix marketplace releases its own mini apps the same way: its repository packs them into the
catalog each of its releases attaches.

People then add `https://github.com/<you>/<repo>/releases/latest/download/mini-app-catalog.json`
from Store → **Sources**. `latest` follows your newest release, so the next release is the next
update.

## Limits

- Only the Localix marketplace's catalog marks publishers as verified and features apps.
- An app is updated by `version` alone. New content under the same version reaches no one who has it
  installed.
- A README's HTML is not shown; write it in Markdown. Images it links by a relative path show their
  alt text.

## Related guides

- [Build a mini app](mini-apps.md)
- [Mini apps](../features/mini-apps.md)
- [Build with the agent](build-with-the-agent.md)

## Source of truth

- [The pack command](https://github.com/rsaryev/localix-marketplace/tree/main/plugins) (in the
  authoring plugin)
- [The Localix marketplace's own packing](https://github.com/rsaryev/localix-marketplace/blob/main/scripts/pack.ts)
- [The media rules](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/manifest/media.ts)
- [Reading a catalog](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/catalog-feed.ts)
- [Serving store media](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/store-media.ts)
- [Installing an archive](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/store-install.ts)

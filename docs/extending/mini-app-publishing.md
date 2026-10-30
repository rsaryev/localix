# Publish a mini app

A mini app reaches other people through a **marketplace**: one `mini-app-marketplace.json` that
lists apps, with one archive per app beside it and each app's icon, screenshots and README next to
them. The Localix core hosts no marketplace: the
[Localix marketplace](https://github.com/rsaryev/localix-marketplace) publishes its own with each of
its releases. Anyone can publish theirs the same way, from a copy of the authoring plugin's template
or with the [plugin](build-with-the-agent.md) itself, and people add it to their Store.
[Mini app marketplaces](mini-app-marketplace.md) is the format's reference.

## Terminology

| Term        | Meaning                                                                    | Boundary                                                                |
| ----------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Manifest    | `.localix-mini-app/mini-app.json` in the app's folder                      | Paths in it are relative to the folder that holds `.localix-mini-app/`. |
| Marketplace | `mini-app-marketplace.json`: the apps on offer and where each archive is   | Archive and media URLs are relative to it, so they move together.       |
| Archive     | A gzip tarball whose root is the app's built folder, its manifest included | Holds only files: no symlinks, no `node_modules`, no install records.   |
| Store media | The app's icon, screenshots and README, published beside the archive       | Each pinned by size and sha256 like the archive.                        |
| Publisher   | The marketplace's `owner`                                                  | Shown as verified only in the Localix marketplace.                      |
| Identity    | `<app>@<marketplace>`, such as `notes@ada`                                 | The same name in two marketplaces is two apps.                          |
| Version     | `version` in the manifest                                                  | The Store offers an update when it differs from the installed one.      |

## What you can do

| Task                         | Do this                                                                                              | Boundary                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Start an app                 | The authoring plugin's `create` command, with what it should do                                      | It forks the plugin's Daily Log template; copy that template to do it by hand.             |
| Give it an icon              | `mini-app icon --glyph '<path d="…"/>'`, or put `icon.svg` in the app and set `"icon": "./icon.svg"` | Required to publish; see [Icon and screenshots](#icon-and-screenshots).                    |
| Show it in the Store         | Add `screenshots`, `tags` and `homepage` to the manifest, and a `README.md`                          | Optional; the README becomes the Store page's About.                                       |
| Pack it                      | `mini-app pack <folder> --publisher "<you>"` (the authoring plugin)                                  | Checks and builds it first, and refuses a missing icon; or the plugin's `publish` command. |
| Publish several apps         | `.localix-mini-app/marketplace.json` in the repository, then `mini-app marketplace build`            | See [A marketplace of several apps](#a-marketplace-of-several-apps).                       |
| Release it from GitHub       | `mini-app ci <folder> --publisher "<you>"`, push, then tag `v<version>`                              | The workflow checks and packs it; see [Hosting on GitHub](#hosting-on-github).             |
| Host the marketplace         | Upload everything in the output folder to one place: a GitHub release, a site                        | Any HTTPS host, or a folder read as `file://`.                                             |
| Add a marketplace to Localix | Store → **Sources** → **Add source…**, or `/mini-app marketplace add <owner/repo or url>`            | Its publisher is shown as unverified.                                                      |
| Link people to it            | Share `localix://ui/work-item/mini-app-store/add-marketplace?url=<owner/repo or encoded address>`    | Opens the Store's add dialog filled in; nothing is added until Add.                        |
| Ship an update               | Raise `version`, pack again, replace the hosted files                                                | Installed copies update within six hours, or at once with Update.                          |
| Take a version back          | `revoked` on the app's entry; see [Revoking an app](mini-app-marketplace.md#revoking-an-app)         | Installed copies stop at the next read of the marketplace.                                 |
| Require a newer Localix      | Raise `apiVersion` in the manifest                                                                   | Older Localix lists the app as needing a newer version.                                    |

## How it works

### Icon and screenshots

The store, the Store (Mini apps) and the Mac app an app can become all show the app's own icon, so
an app is recognisable wherever it appears. Its rail button keeps the line glyph its screen
registers, drawn like every other rail button. `.localix-mini-app/mini-app.json` names the files by
paths inside the app's folder, the one that holds `.localix-mini-app/`:

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

Any square picture is accepted; the standard only keeps a marketplace's apps looking like one
family.

The authoring plugin draws this tile for you: `mini-app icon [folder] --glyph '<path d="…"/>'` puts
a 24×24 glyph (or the path to a 24×24 `.svg` file) on it in `icon.svg`, in `#e7e6e6` unless
`--tint #hex` names another ink, and sets `"icon": "./icon.svg"` when the manifest had none. A copy
of the template keeps the Daily Log icon until you do, and `mini-app check` reports it.

### A marketplace of one app

`mini-app pack` writes a marketplace whose only app is the one packed, named after it and kept by
`--publisher`, with the archive and media beside it, each named with the start of its hash. Editing
it by hand is not needed; [Released marketplace](mini-app-marketplace.md#released-marketplace) shows
what it holds.

### A marketplace of several apps

A repository of several apps keeps its marketplace beside them as
`.localix-mini-app/marketplace.json`, each app's `source` the path of its folder:

```json
{
  "schema": 3,
  "name": "ada",
  "owner": { "name": "Ada Lovelace" },
  "apps": [
    { "name": "notes", "source": "./apps/notes" },
    { "name": "timer", "source": "./apps/timer" }
  ]
}
```

`mini-app marketplace validate` checks it, strictly, and `mini-app marketplace build` packs every
app and writes the released `mini-app-marketplace.json` with `archive` sources. An entry may also
link an app another marketplace publishes (`{ "source": "github", "repo": "grace/habits" }`): the
app is read, signed and updated from there, and offered as `habits@ada`. See
[Sources](mini-app-marketplace.md#sources).

### Localix Community

[Localix Community](https://github.com/rsaryev/localix-community) lists plugins and mini apps that
people publish in their own repositories. It holds no code: its `.localix-mini-app/marketplace.json`
links each mini app to its author's marketplace, and its `.claude-plugin/marketplace.json` names
each plugin's repository. Localix reads it from the start, under the name **Localix Community**.
Localix does not vouch for what it lists: its publishers are unverified, installing asks first, its
curation never reaches Discover, and its apps are `<app>@localix-community`, never the Localix
marketplace's. Each app is signed, or not, by its author, and updates as any app from that author's
marketplace would.

To list an app, publish it (`/mini-app-authoring:publish`), then open a pull request that adds an
entry to its `.localix-mini-app/marketplace.json`:

```json
{
  "name": "notes",
  "source": { "source": "github", "repo": "ada/notes" },
  "description": "Notes beside every chat.",
  "category": "utilities",
  "homepage": "https://github.com/ada/notes"
}
```

### How the Store shows media

The Store never hands a marketplace's addresses to the page. It serves every file through the API
(`/rpc/mini-apps/store/media/<app>@<marketplace>/icon`, `…/screenshot/<n>`): a marketplace's file is
fetched once, refused unless its size and sha256 match the marketplace, kept under
`~/.localix/cache/mini-app-store`, and checked to be the image it claims. Responses carry
`X-Content-Type-Options: nosniff`, and an SVG a `Content-Security-Policy` that loads and runs
nothing; the page shows an SVG only as an image. A media address must be HTTPS, or a file beside a
marketplace read from a folder.

### Installing and updating

The Store downloads an archive with progress, and resumes an interrupted download. It refuses the
archive when its size or sha256 differs from the marketplace's, or when Localix blocks that build.
It then unpacks the archive into a folder beside the installed copy, refusing any path that leaves
the folder and anything larger than 512 MB. It checks that the manifest names the promised app and
version, and swaps the folder in with one rename. A failure at any step keeps the version that was
installed.

Apps from a signed marketplace take its newer versions on their own, a minute after Localix starts
and every six hours, unless you untick **Update automatically** in the **⋯** menu on the app's Store
page. Apps from an unsigned marketplace are never updated behind your back: the Store offers the
newer version and installs it when you choose **Update**. An app updates only from the marketplace
it was installed from: `notes@grace` is never an update of `notes@ada`.

One computer runs one app of a name, because the name is how its tools, commands and folder are
known. Installing `notes@grace` while `notes@ada` is installed says which one is there; remove it
first. A folder you made yourself under `~/.localix/mini-apps/` is never replaced by a marketplace's
app of the same name; installing one says the name is taken.

### Trust

Installing an app from an unverified publisher asks first in the Store, in a sheet that says what
would run. Choosing **Install** is the yes that lets its backend run, as for any mini app you allow.
A mini app's backend runs as trusted local code: a marketplace decides where an app comes from, not
what it may do.

### Signing

A marketplace can be signed: beside `mini-app-marketplace.json` sits
`mini-app-marketplace.json.sig`, Ed25519 signatures of the file's exact bytes. The Store shows each
app as **Signed**, **Not signed** or **Signature changed**; only a signed marketplace's apps update
on their own. A marketplace you add keeps the keys of its first signed read, and a release signed
with a kept key may name the keys that sign the next one. See
[Signing](mini-app-marketplace.md#signing) for the file, rotating a key and rollback.

### Adding a marketplace

Adding a marketplace reads it first. The Store's **Add source…** dialog shows who keeps it, how many
apps it holds and their first icons, and adds it only when the person chooses **Add**;
`/mini-app marketplace add <owner/repo or url>` replies with the same before keeping it. A GitHub
repository is enough: `ada/notes` reads its latest release's `mini-app-marketplace.json`. Its apps
are then in the Store as `<app>@<marketplace>`. `/mini-app marketplace list` shows every marketplace
with its app count, and `/mini-app marketplace remove <name or url>` removes one you added. A second
marketplace with a name already added is refused.

A link such as `localix://ui/work-item/mini-app-store/add-marketplace?url=ada%2Fnotes` opens the
Store with that dialog filled in, from a chat or from outside the app.

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

The workflow checks every push and pull request. On a tag that matches `version` in the manifest it
packs the marketplace and attaches it to a GitHub release; a tag that does not match fails the run.
It builds with the toolchain and kit of the Localix release the app was made with; run `mini-app ci`
again after updating Localix. The plugin's `publish` command does all of this, updates included.

Without the workflow, pack on your computer and upload the folder's files as a release's assets:
`mini-app pack notes --publisher "Ada" --out dist/marketplace`, then
`gh release create v1.2.0 dist/marketplace/*`.

The Localix marketplace releases its own mini apps the same way: its repository builds them into the
marketplace each of its releases attaches.

People then add `<you>/<repo>` from Store → **Sources**: Localix reads
`https://github.com/<you>/<repo>/releases/latest/download/mini-app-marketplace.json`. `latest`
follows your newest release, so the next release is the next update.

## Limits

- Only the Localix marketplace marks publishers as verified and features apps.
- An app is updated by `version` alone. New content under the same version reaches no one who has it
  installed.
- A README's HTML is not shown; write it in Markdown. Images it links by a relative path show their
  alt text.

## Related guides

- [Mini app marketplaces](mini-app-marketplace.md)
- [Build a mini app](mini-apps.md)
- [Mini apps](../features/mini-apps.md)
- [Build with the agent](build-with-the-agent.md)

## Source of truth

- [The pack command](https://github.com/rsaryev/localix-marketplace/tree/main/plugins) (in the
  authoring plugin)
- [The Localix marketplace's own packing](https://github.com/rsaryev/localix-marketplace/blob/main/scripts/pack.ts)
- [The media rules](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/manifest/media.ts)
- [Reading a marketplace](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/marketplace-feed.ts)
- [Serving store media](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/store-media.ts)
- [Installing an archive](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/store-install.ts)

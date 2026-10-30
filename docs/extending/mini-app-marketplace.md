# Mini app marketplaces

A **marketplace** is how mini apps reach people: one JSON file that lists apps, who keeps it, and
where each app is. It has the shape of a Claude Code `marketplace.json`, with `apps` where Claude
Code has `plugins`. This page is the format's reference;
[Publish a mini app](mini-app-publishing.md) walks through publishing one.

## Terminology

| Term                   | Meaning                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Manifest               | `.localix-mini-app/mini-app.json` in an app's folder: what the app is.                        |
| Marketplace (source)   | `.localix-mini-app/marketplace.json` in a repository: which apps it lists and where they are. |
| Marketplace (released) | `mini-app-marketplace.json`: the same file built, each app an archive pinned by its sha256.   |
| Signature              | `mini-app-marketplace.json.sig` beside the released file: Ed25519 signatures of its bytes.    |
| App identity           | `<app>@<marketplace>`, such as `notes@ada`.                                                   |

## Layout

A mini app keeps its manifest in `.localix-mini-app/`, as a Claude Code plugin keeps its own in
`.claude-plugin/`. A repository that publishes apps keeps its marketplace beside it:

```text
notes/                              one app, published by its author
  .localix-mini-app/
    mini-app.json
    marketplace.json                optional: without it, the app is the marketplace's only app
  guide.md
  icon.svg
  backend/  ui/  shared/

localix-marketplace/                many apps, and Claude Code plugins beside them
  .claude-plugin/marketplace.json
  .localix-mini-app/marketplace.json
  mini-apps/chess/.localix-mini-app/mini-app.json
  plugins/team/.claude-plugin/plugin.json
```

Paths in `mini-app.json` (`icon`, `backend`, `screenshots`) are relative to the app's folder, the
one that holds `.localix-mini-app/`. A folder holds `.localix-mini-app/` or `.claude-plugin/`, never
both.

## The marketplace file

```json
{
  "$schema": "https://localix.ai/schemas/mini-app-marketplace/v3.json",
  "schema": 3,
  "name": "ada",
  "owner": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "metadata": { "description": "Ada's mini apps." },
  "apps": [
    { "name": "notes", "source": "./apps/notes" },
    {
      "name": "habits",
      "source": { "source": "github", "repo": "grace/habits" },
      "description": "Track daily habits with the agent beside you.",
      "category": "utilities"
    }
  ],
  "collections": [
    {
      "id": "write",
      "title": "Write with the agent",
      "style": "row",
      "items": ["notes", "plugin:docs@claude-plugins-official"]
    }
  ]
}
```

| Field         | Rule                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `$schema`     | Optional. The JSON Schema editors complete and check the file with; Localix does not read it.                          |
| `schema`      | Required, `3`. The format's version: see [How the format changes](#how-the-format-changes).                            |
| `name`        | Required. Lower-case words joined by dashes, 2 to 64 characters. The second half of each app's identity.               |
| `owner`       | Required. `{ "name", "email"?, "url"? }`: who keeps the marketplace and publishes the apps it builds.                  |
| `metadata`    | Optional. `{ "description" }`, shown with the marketplace in Store → **Sources**.                                      |
| `apps`        | Required. Each app once, sorted by `name`.                                                                             |
| `collections` | Optional. Rows of Discover, read only from a marketplace Localix trusts: see [Curation](#curation).                    |
| `published`   | Written by the build: when this release was made. See [Rollback](#rollback).                                           |
| `signingKeys` | Written by the build: the public keys that sign the marketplace's next release. See [Rotating a key](#rotating-a-key). |

### Apps

| Field     | Rule                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `name`    | Required. Letters, digits, dashes or underscores, at most 64; the app's `name` in its manifest. Unique in the marketplace. |
| `source`  | Required, unless the app is revoked as a whole. Where the app is: see [Sources](#sources).                                 |
| facts     | A linked app may say `description` (10 to 2000 characters, required), `displayName`, `category` and `homepage`.            |
| curation  | `featured`, `installByDefault`, `suggestFor`: see [Curation](#curation).                                                   |
| `revoked` | `{ "reason", "versions"? }`: see [Revoking an app](#revoking-an-app).                                                      |

An app built from a folder says nothing else by hand: the build copies its facts from its manifest
(`displayName`, `description`, `category`, `version`, `apiVersion`, `tags`, `author`, `license`,
`homepage`, `surfaces`, `commands`, `fileAssociations`) and pins its icon, screenshots and README.

### Sources

| `source`                                            | Where it appears  | Meaning                                                                |
| --------------------------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `"./path"`                                          | the source file   | A folder of this repository holding `.localix-mini-app/mini-app.json`. |
| `{ "source": "archive", "url", "bytes", "sha256" }` | the released file | The built app beside the marketplace, written by the build.            |
| `{ "source": "github", "repo": "owner/name" }`      | both              | The app in the marketplace that repository's latest release publishes. |
| `{ "source": "url", "url": "https://…" }`           | both              | The app in the released marketplace at that address.                   |

Unlike Claude Code's, a `github` or `url` source names a released marketplace, not a git repository:
a mini app is installed built, never built on the person's computer. A linked app is read from its
own marketplace, which says what it is, signs it with its author's key and is where it installs and
updates from; what the linking marketplace says fills in only what that one leaves out. A link is
followed once: links in the linked marketplace are not.

### Curation

Curation is what a marketplace's keeper chooses to show, rather than what an app is. Localix reads
it only from the Localix marketplace and ignores it everywhere else; Localix Community's checks
refuse it.

| Field              | Meaning                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `featured`         | `true` puts the app in Discover's featured carousel.                                                                       |
| `installByDefault` | `true` installs the app on its own, once, on a new installation.                                                           |
| `suggestFor`       | `{ "files"?, "dependencies"? }`: the Store suggests the app for a project holding such a file or depending on the package. |
| `collections`      | Discover's rows: `id`, `title`, `subtitle`?, `style` (`row` or `grid`) and `items`.                                        |

`files` are file names, where `*` stands for any characters (`compose.yaml`, `*.tf`); a file the app
opens is suggested from its manifest's `fileAssociations` already, so it does not belong here. A
collection's item is an app of this marketplace by name, or `<kind>:<id>` for any other package:
`mini-app:notes@ada`, `plugin:neon@claude-plugins-official`.

The Localix marketplace's `.claude-plugin/marketplace.json` carries the same curation for its
plugins, under a `localix` key, because that file is Claude Code's format: `plugins[].localix` holds
an entry's `featured`, `installByDefault` and `suggestFor`, and `metadata.localix.collections` its
rows. Claude Code ignores both.

## Identity

An app is `<app>@<marketplace>`: `notes@ada` and `notes@grace` are different apps, as a Claude Code
plugin is `<plugin>@<marketplace>`. A marketplace's name is unique on one computer: adding a second
one of the same name is refused, and `localix` and `localix-community` are Localix's own. A linked
app is known by the marketplace that lists it: `habits@localix-community`.

The name alone names the app inside Localix (its tools, its commands as `/<app>:<command>`, its
folder), so one computer runs one app of a name. Installing `notes@grace` while `notes@ada` is
installed says which one is there; remove it first.

## Released marketplace

`mini-app marketplace build` reads the source file, checks it, builds each folder's app, and writes
the released marketplace with the archives and media beside it. Each file is named with the start of
its hash; every address is relative, so the folder is uploaded together: a GitHub release, a site, a
folder read as `file://`.

```json
{
  "schema": 3,
  "name": "ada",
  "owner": { "name": "Ada Lovelace" },
  "published": "2026-10-30T12:00:00.000Z",
  "signingKeys": ["bwCq5MPyZb+OxOHQnaBtzi9GmXBvu1U6WnGeyEPhdXg="],
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
        "sha256": "3fa1…"
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
      "author": "Ada Lovelace",
      "surfaces": ["agent", "workbench"],
      "commands": ["new"],
      "fileAssociations": [{ "ext": ["note"], "name": "Note", "role": "Editor" }]
    }
  ]
}
```

An archive is a gzip tarball whose root is the app's built folder, `.localix-mini-app/mini-app.json`
included. It holds only files: no symlinks, no `node_modules`. Its publisher is the marketplace's
`owner`; only a marketplace Localix trusts shows it as verified.

A repository on GitHub publishes its marketplace as its releases' asset `mini-app-marketplace.json`,
so `owner/name` is enough to add it: Localix reads
`https://github.com/<owner>/<name>/releases/latest/download/mini-app-marketplace.json`.

## Signing

Beside the released file sits `mini-app-marketplace.json.sig`, Ed25519 signatures of the file's
exact bytes:

```json
{
  "schema": 2,
  "signatures": [
    { "algorithm": "ed25519", "key": "<32 bytes, base64>", "signature": "<64 bytes, base64>" }
  ]
}
```

A signature proves who wrote a marketplace only against keys known from before, so Localix keeps a
set per marketplace: the Localix marketplace's and Localix Community's are built into Localix, and
one you add keeps the keys of its first signed read. A marketplace is signed when one of its
signatures holds for a kept key; a signature of an algorithm Localix does not know is passed over.

| State                 | When                                                                     | Its apps                                             |
| --------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Signed**            | A signature holds for a kept key.                                        | Update on their own.                                 |
| **Not signed**        | No key is kept for the marketplace.                                      | Install and update when you ask.                     |
| **Signature changed** | Keys are kept, and no signature holds for one: re-signed, or not signed. | Nothing is installed or updated; the Store says why. |

### Rotating a key

`signingKeys` in the signed file names the keys that sign the next release. After a signed read,
Localix keeps exactly those. To move to a new key, publish one release signed with the old key that
lists the new one, then sign with the new key. A key that leaks is replaced the same way, and with a
Localix release for the marketplaces built into Localix.

### Rollback

`published` is when the release was made, inside the signed bytes. Localix keeps the newest it has
read for each marketplace and refuses an older one, or one that stops saying it, so an old signed
release with a version since fixed cannot be served again.

## Revoking an app

An app's marketplace takes it back with `revoked`:

```json
{
  "name": "notes",
  "source": "./apps/notes",
  "revoked": { "reason": "Sends notes to a third party.", "versions": ["1.2.0"] }
}
```

Without `versions`, every version is revoked, and the entry needs no `source`. A revoked copy stops
on every computer that reads the marketplace: its code no longer loads, its tile says **Taken
back**, and its Store page gives the reason, with **Remove** in its menu. Its data stays. Localix
reads a revocation from the marketplace an app was installed from and, for a linked app, from its
author's marketplace. An update to a version that is not revoked starts it again, as does the
marketplace offering it again; a marketplace that cannot be read takes nothing back and gives
nothing back.

The Localix marketplace may also block an archive whatever marketplace it came from:

```json
{ "blockedArchives": [{ "sha256": "3fa1…", "reason": "Malware." }] }
```

## How the format changes

`schema` only grows, and a number is never used twice. Within one, the format changes only by
adding: a field Localix does not know is passed over, and a field that does not read is dropped
alone, so a bad icon never hides its app and an app that does not read is left out while the rest of
the marketplace loads. A Localix that meets a newer `schema` says to update Localix rather than
guess. `mini-app marketplace validate` is strict where Localix is lenient: an unknown field is an
error, so a typo is found before it is published.

Room is kept for what is expected next, each as a new field: translations (`localized`), archives
per platform, and a source type for a marketplace served by an API.

## Related guides

- [Publish a mini app](mini-app-publishing.md)
- [Build a mini app](mini-apps.md)
- [Store](../features/store.md)

## Source of truth

- [The marketplace schema](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/marketplace/schema.ts)
- [Signatures](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/marketplace/signature.ts)
- [Reading a marketplace](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/marketplace-feed.ts)
- [The build](https://github.com/rsaryev/localix-marketplace/tree/main/plugins/mini-app-authoring)

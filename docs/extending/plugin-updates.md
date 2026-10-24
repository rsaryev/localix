# Built-in plugins and updates

Localix ships a few Claude Code plugins inside the app, registers its official marketplace on first
start, and keeps plugins installed from marketplaces up to date the way Claude Code does. Use this
page to see what is built in, where a plugin's version comes from, and when an update runs.

## What you can do

| Outcome                                       | How                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| Turn a built-in plugin off                    | Its switch in Settings → Capabilities → Plugins → **Built-in**            |
| Update one plugin now                         | **Update now** on its row, or `/plugin update <name>`                     |
| Update a marketplace and its plugins          | **Update marketplace** on its row, or `/plugin marketplace update <name>` |
| Refresh every listing, installing nothing     | `/plugin marketplace update`                                              |
| Turn auto-update on or off for a marketplace  | The switch on its row under **Marketplaces**                              |
| Use the built-in plugins in plain Claude Code | `claude plugin marketplace add rsaryev/localix`                           |

## How it works

### Built-in plugins

A built-in plugin ships inside Localix, like Claude Code's `<name>@builtin` ones: its source is
`builtin`, and Settings → Capabilities → Plugins lists it in a **Built-in** group. It is on unless
its manifest sets `defaultEnabled: false`, and its switch turns it off like any plugin's. It has no
**Remove** and no **Update now**: `/plugin remove` and `/plugin update` refuse it, and it updates
when Localix does. `builtin` is a reserved origin, so no marketplace can register under it.

| Built-in plugin     | What it adds                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `localix-mini-apps` | A `build-mini-app` skill and `/localix-mini-apps:new`, `check`, `build`, `pack` and `publish` commands |

**Name conflicts:** a built-in plugin holds its name over every other copy, as managed plugins do in
Claude Code. Localix's order, highest first, is built-in, your installs (`~/.localix/plugins` and
the version cache), plugins loading in place from a local-folder marketplace, plugins Claude Code
installed, then a project's own plugins under a name nothing else holds. A copy that loses its name
to a built-in plugin does not load, and the built-in plugin's row says where that copy is.
Installing a plugin under a built-in name is refused.

The source of the built-in plugins is the repository's
[`plugins/`](https://github.com/rsaryev/localix/tree/main/plugins) folder. The same folders are
listed in the repository's own `.claude-plugin/marketplace.json`, so in plain Claude Code:

```bash
claude plugin marketplace add rsaryev/localix
claude plugin install localix-mini-apps@localix
```

### The official marketplace

On first start Localix registers `localix` from the GitHub repository `rsaryev/localix`, the way
Claude Code adds `claude-plugins-official`: only the catalog and `plugins/` are checked out. It is
not bundled, so it needs the network once; offline (or with
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set) it is skipped and tried again at the next start.
Removing it is remembered: it is not added back until you add it yourself with
`/plugin marketplace add rsaryev/localix`. A plugin that is both built in and listed there appears
once, as built-in.

### Updates

Localix computes a version for every plugin it installs from a marketplace, as Claude Code does, and
the version is how an update is detected:

1. the `version` in the plugin's manifest;
2. else the `version` on its marketplace entry;
3. else one from the source: a git commit shortened to 12 characters (`github`, `url`, `git-subdir`,
   which also carries a hash of its path, and a relative path in a marketplace cloned from git), an
   archive's `sha256` shortened to 12, or `unknown` for a local folder or `npm`.

A manifest that pins `"version": "1.0.0"` therefore keeps everyone on that copy until the string
changes. An entry pinned to a `sha` never moves. A plugin that loads in place from a local-folder
marketplace has no versions: it loads its current files.

A user-scope copy from a marketplace lives in
`~/.localix/plugins/cache/<marketplace>/<plugin>/<version>/`, recorded in
`~/.localix/plugins/installed_plugins.json` in Claude Code's shape. An update installs the new
version beside the old one and points the record at it; an unchanged version installs nothing
(`<name> is already at the latest version`). The old version folder gets an `.orphaned_at` marker
and is removed 14 days later, so whatever already started from it keeps its files. An update that
fails keeps the version before. Uninstalling orphans the version the same way.

**When updates run.** Auto-update is on by default for the official `localix` marketplace and off
for every other one; the switch on a marketplace's row changes it. Claude Code updates once per
session, a random delay of up to ten minutes after the first message. Localix keeps running, so the
pass runs a random one to ten minutes after start and then every six hours: it refreshes each
marketplace with auto-update on, updates the plugins installed from it on disk, and sweeps orphaned
versions. A run already under way keeps what it loaded; the next run loads the new version, and
plugin monitors and mods reload when the update lands.

| Environment variable                                                                 | Effect                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `DISABLE_UPDATES`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | The whole pass is off and the switches are hidden |
| `FORCE_AUTOUPDATE_PLUGINS=1`                                                         | Keeps the pass on despite those                   |

**Update now** on a plugin's row updates it at once, with its progress on the row; it appears when
the marketplace's listing resolves to another version. What is available is computed from the
listings without installing anything: Settings → Capabilities → Plugins fetches the listings when it
opens, and every marketplace refresh checks again. An unpinned git entry is compared by its remote
commit. **Update marketplace** refreshes the listing and updates the plugins installed from it, and
names any it leaves for you, such as an entry with a `headersHelper`. Localix does not read
`extraKnownMarketplaces` from Claude Code's settings files: a marketplace's `autoUpdate` lives on
its record in `~/.localix/marketplaces/known.json`.

## Limits

- Only user-scope copies from a marketplace go into the version cache and are auto-updated; a
  project install stays a copy in the project, and a plugin loading in place has no versions.
- An archive entry without a `sha256` pin, and an npm entry, have the version `unknown` unless a
  `version` field is set, so they are not updated on their own.
- A remote git entry is checked by its commit without being fetched, so a new commit whose manifest
  keeps the same `version` shows as an update once; applying it installs nothing and says so.
- A built-in plugin changes only with a Localix release; in development, after a restart of
  `bun run dev`.

## Related guides

- [Install Claude Code plugins](claude-code-plugins.md)
- [Build a mini app](mini-apps.md)
- [Build with the agent](build-with-the-agent.md)

## Source of truth

- [Built-in plugins](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/builtin-plugins.ts)
- [The version rule](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/plugin-version.ts)
- [The version cache](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/plugin-cache.ts)
- [Updates and the auto-update pass](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/plugin-updates.ts)
- [Which marketplaces auto-update](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/marketplace-auto-update.ts)
- [The official marketplace](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/official-marketplace.ts)

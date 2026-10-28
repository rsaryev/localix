# mini-app-authoring

A Claude Code plugin for making [Localix](https://github.com/rsaryev/localix) mini apps — screens, a
backend and agent tools that run inside Localix — and sharing them. It works the same in Claude Code
and in Localix.

**In Localix** it is built in: nothing to install. Type `/mini-app-authoring:create` in any chat
with what the app should do.

**In Claude Code**, add it once:

```text
/plugin marketplace add rsaryev/localix
/plugin install mini-app-authoring@localix
```

## What it adds

| Part                                | What it does                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `/mini-app-authoring:create <idea>` | Creates a mini app from a description, builds it out, checks it and installs it   |
| `/mini-app-authoring:check`         | Every gate Localix applies, in one report, then fixes what fails                  |
| `/mini-app-authoring:install`       | Builds the package and installs it into the running Localix                       |
| `/mini-app-authoring:publish`       | Puts the source on GitHub; its workflow releases each version tag as a catalog    |
| `/mini-app-authoring:get-localix`   | Installs the latest Localix, verified against the release's checksums             |
| `reference` skill                   | The format and the SDK contract, with recipes; loaded when Claude writes an app   |
| `mini-app-reviewer` agent           | Reviews a mini app for what the checks cannot see, with the reference preloaded   |
| Edit hook                           | After each edit to a mini app's source, reports what breaks Localix's rules       |
| `mini-app` command                  | The toolchain the skills run; on the Bash tool's PATH while the plugin is enabled |

```text
mini-app create <name> [--title "…"] [--description "…"] [--dir <folder>]
mini-app check [folder]      mini-app build [folder]      mini-app install [folder]
mini-app pack [folder] --publisher "…" [--out <dir>]      mini-app validate <package | .tar.gz>
mini-app icon [folder] --glyph '<path d="…"/>' [--tint #hex]
mini-app ci [folder] [--publisher "…"]
mini-app contract            mini-app kit                 mini-app get-localix
```

A new app is a copy of the kit's reference app, Daily Log, whose plumbing — routes, storage, the
feed that updates an open screen when the agent writes, semantic search — is the SDK's app layer
(`createMiniApp`, `defineCollection`, `useCollection`, `screenUi`). `mini-app create` prints the
whole contract with the instruction, so the agent writes only the domain and the screen;
`mini-app contract` prints it again any time.

## Publishing from GitHub

`mini-app ci` sets an app up to be released from its repository: it writes
`.github/workflows/mini-app.yml`, keeps what the checks generate out of git, and records the
publisher as `author`. The workflow checks every push and pull request. A tag `v<version>` matching
`mini-app.json` makes it pack the catalog and attach it to a GitHub release, so people add
`https://github.com/<owner>/<repo>/releases/latest/download/mini-app-catalog.json` once and get
every later version. It builds with the toolchain and kit of the Localix release the app was made
with, checking out only this plugin's folder from Localix's repository at that release's tag.

## How it relates to Localix

Localix runs and manages mini apps: it installs, updates, enables and validates them. Making one is
this plugin's job. The two meet in two places:

- **The mini app kit.** Each Localix release publishes the platform a mini app is built against —
  the reference template, the SDK and UI kit declarations, the host theme, the modules the host
  lends at runtime, and Localix's own validation rules. `mini-app` uses the running Localix's kit,
  else the installed app's, else the latest release's `mini-app-kit.tar.gz` (verified against its
  `SHA256SUMS.txt` and kept in the plugin's data folder). `MINI_APP_KIT=<folder>` names one.
- **Installing.** `mini-app install` hands the built package to the running Localix
  (`POST /rpc/mini-apps/install-local`); Localix validates and installs it. A shared catalog is
  installed from Localix's mini app store like any other.

The plugin depends on nothing but Bun (it finds one on PATH, in `~/.bun`, or inside Localix) and
imports nothing from the Localix repository, so it can live in a repository of its own.

## Developing it

```bash
bun test src
bunx tsc --noEmit -p tsconfig.json
```

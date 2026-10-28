# mini-app-authoring

A Claude Code plugin for making [Localix](https://github.com/rsaryev/localix) mini apps — screens, a
backend and agent tools that run inside Localix — and sharing them. It works the same in Claude Code
and in Localix, which loads Claude Code plugins.

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
| `/mini-app-authoring:publish`       | Packs the app into a catalog, hosts it and gives people the address to add        |
| `/mini-app-authoring:get-localix`   | Installs the latest Localix, verified against the release's checksums             |
| `reference` skill                   | The mini app format, loaded by Claude when it writes one                          |
| `mini-app-reviewer` agent           | Reviews a mini app for what the checks cannot see                                 |
| Edit hook                           | After each edit to a mini app's source, reports what breaks Localix's rules       |
| `mini-app` command                  | The toolchain the skills run; on the Bash tool's PATH while the plugin is enabled |

```text
mini-app create <name> [--title "…"] [--description "…"] [--dir <folder>]
mini-app check [folder]      mini-app build [folder]      mini-app install [folder]
mini-app pack [folder] --publisher "…" [--out <dir>]      mini-app validate <package | .tar.gz>
mini-app kit                 mini-app get-localix
```

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

# Use Localix from the command line

The `localix` binary is a launcher: it sends a folder or file to the registered desktop app. Use it
to continue in Localix from wherever your shell already is.

## What you can do

| Invocation            | Result                                         | Boundary                                               |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `localix`             | Hand the current directory to the desktop app. | This is the default command.                           |
| `localix <path>`      | Hand an absolute or relative path to the app.  | A registered `localix://` desktop handler is required. |
| `localix open [path]` | Use the explicit path-handoff form.            | An omitted path resolves to the current directory.     |
| `localix help`        | Print the command and option reference.        | No path is opened.                                     |

The first bare token is a path unless it is `open` or `help`. The desktop app treats a directory as
a project and a file as an editor target.

The command starts no server, renders no session, and opens no browser. Everything the agent does
happens in the desktop app it hands the path to.

## How it works

### Path handoff

The `open` command expands `~`, resolves a relative path from the current directory, and encodes the
result as `localix://open?path=...`. It passes that URL to `open` on macOS, `xdg-open` on Linux, or
`rundll32 url.dll,FileProtocolHandler` on Windows (no shell parses the URL).

The CLI does not inspect the target or create a project. The desktop handler resolves that path and
may activate an existing window or launch the app. `-n` adds `new=1` to request fresh handling.

The JavaScript shim re-executes under Bun when Node starts it, because the typed CLI is TypeScript.
It exits `1` when Bun cannot be located.

| Installation shape | CLI entry                   |
| ------------------ | --------------------------- |
| Source checkout    | TypeScript source in `src/` |
| Desktop package    | Bundled CLI shim and entry  |

## Configuration

### Install the launcher

Install, reinstall, or remove the launcher from **Settings → System → Command line**. The installer
writes a user-owned shim and reports when its directory is absent from `PATH`; it does not edit
shell startup files.

| Platform       | Launcher path                            |
| -------------- | ---------------------------------------- |
| macOS or Linux | `~/.local/bin/localix`                   |
| Windows        | `%LOCALAPPDATA%\Localix\bin\localix.cmd` |

Portable Linux AppImage mounts are temporary, so they cannot back a durable launcher. Install the
`.deb` package to enable the command-line launcher on Linux. On startup, an AppImage removes only a
legacy `localix` launcher that still points into an expired `.mount_*` path; launchers installed by
durable packages are left untouched.

The launcher forwards all arguments to the CLI shim with the Bun executable selected by the local
runtime. Desktop startup best-effort installs a missing launcher or refreshes one whose contents
point at a different CLI entry. **Reinstall** repeats the operation on demand; ordinary web
development does not automatically install a launcher.

### Flags

| Flag              | Effect                                |
| ----------------- | ------------------------------------- |
| `-n`, `--new`     | Add `new=1` to the desktop deep link. |
| `-h`, `--help`    | Print the command reference.          |
| `-v`, `--version` | Print `localix <version>`.            |

## Limits

- A failed desktop handoff writes an error to stderr but does not set a nonzero exit status. Do not
  treat `localix <path>` status as proof that the app opened the path.
- An unknown flag is a usage error and exits `2`. A misspelled bare command is treated as a path,
  because path shorthand takes precedence over unknown-command reporting.
- Opening a path requires an installed desktop app that registered the `localix://` scheme. The
  command cannot open anything on a machine that has only the launcher.

## Related guides

- [Sessions and projects](sessions-and-projects.md)
- [Workspace](workspace.md)
- [Installation](../getting-started/installation.md)

## Source of truth

- [CLI launcher](https://github.com/rsaryev/localix/blob/main/packages/cli/bin/localix.mjs)
- [Argument parser](https://github.com/rsaryev/localix/blob/main/packages/cli/src/args.ts)
- [Help text](https://github.com/rsaryev/localix/blob/main/packages/cli/src/commands/help.ts)
- [Path resolution and deep links](https://github.com/rsaryev/localix/blob/main/packages/cli/src/open-url.ts)
- [Launcher install plan](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/shell-command/plan.ts)
- [Launcher install service](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/shell-command/service.ts)

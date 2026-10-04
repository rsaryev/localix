# Localix CLI workspace

This private workspace builds Localix's command-line launcher: `localix <path>` hands a folder or
file to the running desktop app. It starts no server, renders no session, and opens no browser.

## Consumers

The desktop sidecar build stages the launcher shim and its bundled entry. The API's shell-command
service installs that staged launcher on `PATH`. Local package builds use the `localix` executable
declared in `package.json`.

## Entry points

| Entry point                             | Contract                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `localix`, `localix .`                  | Resolve the current directory and send a `localix://open` deep link to the desktop app.                     |
| `localix <path>`, `localix open <path>` | Resolve the path and send the same deep link. Directories open as projects and files open in an editor tab. |
| `localix --help`, `localix --version`   | Print command help or the package version without opening anything.                                         |

## Limits

- Bun 1.3 or newer is required. A Node invocation locates Bun and re-executes the launcher under it.
- Opening a path requires a registered, running desktop app. The command does not start a runtime of
  its own, and a failed handoff is reported on stderr rather than through the exit status.
- This workspace remains private until a verified Localix package scope and release channel exist.

## Source of truth

- [Package manifest](package.json)
- [Launcher](bin/localix.mjs)
- [Package build](scripts/build.mjs)
- [Typed command router](src/main.ts)
- [Argument contract](src/args.ts)

## License

MIT. See [LICENSE](LICENSE).

# Localix CLI workspace

This private workspace builds Localix's command-line launcher: `localix <path>` hands a folder or
file to the registered desktop app. It starts no server, renders no session, and opens no browser.

## Consumers

The desktop sidecar build stages the launcher shim and its bundled entry. The API's shell-command
service writes a launcher shim and reports whether its directory is on `PATH`. Local package builds
use the `localix` executable declared in `package.json`.

## Entry points

| Entry point                             | Contract                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `localix`, `localix .`                  | Resolve the current directory and send a `localix://open` deep link to the desktop app.                     |
| `localix <path>`, `localix open <path>` | Resolve the path and send the same deep link. Directories open as projects and files open in an editor tab. |
| `localix --help`, `localix --version`   | Print command help or the package version without opening anything.                                         |

## Limits

- Bun 1.3 or newer is required. A Node invocation locates Bun and re-executes the launcher under it.
- Opening a path requires an installed app with a registered `localix://` handler. The operating
  system can activate its window or launch it. The CLI starts no API of its own.
- A failed OS handoff is reported on stderr without a nonzero exit status. Unknown flags exit `2`;
  loading failures or a missing Bun executable exit `1`.
- This workspace remains private until a verified Localix package scope and release channel exist.

## Source of truth

- [Package manifest](package.json)
- [Launcher](bin/localix.mjs)
- [Package build](scripts/build.mjs)
- [Typed command router](src/main.ts)
- [Argument contract](src/args.ts)

## License

MIT. See [LICENSE](LICENSE).

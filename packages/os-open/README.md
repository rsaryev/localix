# `@localixai/os-open`

This package is internal to the Localix workspace and is not intended for outside consumption. It
owns the one way a Bun or Node surface hands something to the operating system: a URL for its scheme
handler, a file for its default application, a file for one named application, or a file revealed in
the file manager.

## Consumers

The API uses it for every path, application, and reveal handoff, including the ones it exposes to
plugins through its `files` host port. The CLI launcher uses it to hand its `localix://` deep link
to the registered scheme handler.

The desktop shell keeps its own implementation of the same contract in Rust
(`apps/desktop-tauri/src-tauri/src/commands.rs`, `open_external`), because a URL the user clicked
belongs to the process the user is looking at — not to a sidecar that may not even share their
session. `scripts/check-architecture.mjs` checks first-party core and package JavaScript/TypeScript
for direct OS-opener spawns outside this package. Rust implements the shell handoff separately.

On Windows a URL or path opens through `rundll32 url.dll,FileProtocolHandler`, which hands it to
ShellExecute with no shell in between. `cmd /c start` is never used: cmd.exe parses the target, so
an `&` in a URL query started a second command.

## Entry points

| Export            | Contract                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handoffCommand`  | Pure: the command line one platform uses for one intent, plus whether that process is an opener (its exit status answers) or the app.                       |
| `performHandoff`  | Runs the command, waits for opener exit or app spawn, and returns `{ ok: true }` or a readable failure reason. An optional `log` callback records attempts. |
| `currentPlatform` | Narrows `process.platform` to the three the table knows; anything else is treated as Linux.                                                                 |

## Limits

- A successful result means the OS accepted the target, not that anything appeared. `open` reports
  success once LaunchServices delivers a URL — including to a stale background browser instance that
  drops it. Supply `HandoffOptions.log` to retain a diagnostic trace; the default logger is a no-op.
- Scheme policy is the caller's. This package does not decide whether a URL is safe to open; the
  UI's outward-action gate and the shell's validator do.
- A target starting with `-` is refused: neither `open` nor `xdg-open` accepts a `--` end-of-options
  marker, so refusing is the only defence against a flag-shaped name.
- `reveal` selects the file only on macOS and Windows. No portable equivalent exists on Linux, so it
  opens the containing directory.

## Source of truth

- [Root exports](src/index.ts)
- [Platform handoff commands](src/command.ts)
- [Execution, timeout, and logging](src/perform.ts)
- [Command contracts](src/command.test.ts)
- [Handoff failure cases](src/perform.test.ts)
- [Direct-opener architecture guard](../../scripts/check-architecture.mjs)

/**
 * The per-platform OS handoff table — PURE DATA, no spawning, so every row is
 * unit-testable without touching the machine.
 *
 * This table used to exist three times: the API's native dialogs (four separate
 * inline `process.platform` ladders), the CLI's deep-link opener, and the desktop
 * shell's Rust command. Three copies meant three different answers to the same
 * questions — does the caller wait? is a non-zero exit a failure? is anything
 * logged? — and the honest one (Rust's `open_external`) was written only after a
 * link that opened nothing had been indistinguishable from one that worked.
 *
 * The Rust side cannot import TypeScript, so it keeps its own implementation of
 * the SAME contract (`apps/desktop-tauri/src-tauri/src/commands.rs`). Everything
 * that runs under Bun or Node comes here.
 */

export type OsPlatform = 'darwin' | 'win32' | 'linux'

/** What is being handed to the OS. The caller says WHAT, this module says HOW. */
export type Handoff =
  /**
   * A URL for whatever is registered to its scheme — `https:` (the browser),
   * `mailto:`, `tel:`, or one of our own (`localix://`). Scheme POLICY is the
   * caller's: the webview gate validates before it ever reaches a process.
   */
  | { kind: 'url'; url: string }
  /** A file or directory, opened in whatever the OS considers its default app. */
  | { kind: 'path'; path: string }
  /** A file opened in one NAMED application (macOS bundle name, binary elsewhere). */
  | { kind: 'app'; path: string; app: string }
  /** A file selected in the OS file manager rather than opened. */
  | { kind: 'reveal'; path: string }

export interface HandoffCommand {
  cmd: string
  args: string[]
  /**
   * Whether this process is an OPENER (it hands the target on and exits) or the
   * APPLICATION ITSELF (it lives as long as the window does).
   *
   * Only an opener's exit status is an answer about the target. Waiting on an
   * application would block for as long as the user keeps it open, which is why
   * `mode: 'app'` off macOS — where we spawn the binary directly — is detached.
   */
  awaits: 'exit' | 'spawn'
  /**
   * Exit status is not evidence here. `rundll32` exits 0 whatever the handler did,
   * and `explorer` returns 1 even when the window opens. A
   * lenient row treats "it ran" as the best answer available and says so.
   */
  lenientExit?: boolean
}

/** The single mapping from an intent to a command line, for one platform. */
export function handoffCommand(platform: OsPlatform, target: Handoff): HandoffCommand {
  const file = target.kind === 'url' ? target.url : target.path

  if (platform === 'darwin') {
    // `open` is an opener for every mode, including `-a`: it asks LaunchServices
    // to activate the handler and exits. Its status is therefore a real answer,
    // which is exactly what the desktop shell relies on.
    if (target.kind === 'app')
      return { cmd: 'open', args: ['-a', target.app, file], awaits: 'exit' }
    if (target.kind === 'reveal') return { cmd: 'open', args: ['-R', file], awaits: 'exit' }
    return { cmd: 'open', args: [file], awaits: 'exit' }
  }

  if (platform === 'win32') {
    // A named app is the binary itself — it does not exit, so we do not wait.
    if (target.kind === 'app') return { cmd: target.app, args: [file], awaits: 'spawn' }
    if (target.kind === 'reveal') {
      // `/select,<path>` is ONE argument: a space between the comma and the path
      // makes Explorer open the parent instead of selecting the file.
      return { cmd: 'explorer', args: [`/select,${file}`], awaits: 'spawn' }
    }
    // NOT `cmd /c start "" <target>`: the target reached cmd.exe's own parser, and
    // libuv quotes an argument only when it has whitespace, so `https://x/?a=1&b=2`
    // ran `b=2` as a second command and `https://x/&calc` launched calc (`|`, `^` and
    // `%VAR%` were live too). `rundll32 url.dll,FileProtocolHandler` hands the target
    // straight to ShellExecute — the default handler for a URL or a file/directory —
    // with no shell in between; it is the same opener Go's `pkg/browser` uses.
    return {
      cmd: 'rundll32',
      args: ['url.dll,FileProtocolHandler', file],
      awaits: 'exit',
      lenientExit: true,
    }
  }

  if (target.kind === 'app') return { cmd: target.app, args: [file], awaits: 'spawn' }
  // No portable "select this file" exists on Linux, so revealing opens the
  // containing directory — the closest thing every desktop environment has.
  if (target.kind === 'reveal') return { cmd: 'xdg-open', args: [parentDir(file)], awaits: 'exit' }
  return { cmd: 'xdg-open', args: [file], awaits: 'exit' }
}

/**
 * The containing directory, without `node:path` — this module stays free of
 * imports so it can be read (and tested) as the plain table it is. Handles both
 * separators because a Linux path can still arrive from a cross-platform caller.
 */
function parentDir(file: string): string {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return cut > 0 ? file.slice(0, cut) : cut === 0 ? file.slice(0, 1) : '.'
}

/** The current platform, or `linux` for anything else Bun happens to run on. */
export function currentPlatform(platform: string = process.platform): OsPlatform {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux'
}

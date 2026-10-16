# Desktop runtime lifecycle

The desktop shell flushes UI state before exit, supervises its API sidecar, and installs signed
updates in release builds. Use this guide when changing quit deadlines, restart recovery, health
probes, or updater behavior. [Desktop packaging](desktop-as-primary-artifact.md) owns bundle staging
and release assembly.

## How it works

### Flush before quitting or restarting

Every way out first lets the page save, then gives the runtime its `shutdown` line and a bounded
wait before the shell kills it.

Editor layout, caret and scroll positions, settings, and message drafts use debounced writes. The
shell flushes them before exit through a before-quit handshake
(`apps/desktop-tauri/src-tauri/src/quit.rs`): it defers the exit, emits `localix://before-quit` to
the page, and waits up to 1.5 s for the page's `quit_ready`. Then it saves the window size and
position and stops the runtime.

The handshake runs in development builds too, where there is no runtime child to stop. On the page,
`apps/ui/src/shared/lib/quitFlush.ts` is the one list of pending writes: each owner registers its
flush there, and the handshake awaits all of them, bounded at 1.2 s. The same list also runs on
`pagehide` and when the page is hidden, which covers the reloads that follow a port handoff or a
runtime respawn.

| Route                                                  | Page flush | Wait before the kill | Why this route                                                    |
| ------------------------------------------------------ | ---------- | -------------------- | ----------------------------------------------------------------- |
| Quit in the app menu, File menu or tray                | 1.5 s      | 6 s                  | `app.exit` raises `ExitRequested`, which defers the exit.         |
| Closing the last window, as Alt+F4 does without a tray | 1.5 s      | 6 s                  | The close is turned into the same `app.exit` while the page runs. |
| `restart_app`; an update install on macOS or Linux     | 1.5 s      | 6 s                  | Tauri cannot defer a restart, so the initiator runs both first.   |
| Windows update install                                 | 1.5 s      | 6 s                  | The installer hook runs both before `std::process::exit`.         |
| macOS Dock Quit or logout; a Windows `WM_QUIT`         | none       | 3 s                  | These reach only `Exit`, as the process is already ending.        |

The window geometry is saved in the handshake as well as on `Exit`, because the Windows installer
path never raises `Exit`. A crash still loses the geometry since the last clean exit.

Quit is a custom menu item, because the predefined one skips `ExitRequested` on macOS and Windows
and does nothing on Linux. It is bound to Cmd+Q on macOS and Ctrl+Q on Linux. Windows File ▸ Exit
has no accelerator: Alt+F4 quits there, and Ctrl+Q stays with the terminal. On Windows the runtime
runs in its own Job Object that kills its remaining processes when the job closes, including when
the shell itself dies.

### Updating

One flow connects a published release to an installed app. Each step names the code that owns it.

1. **Publish.** `release.yml` stamps the tag's version (`scripts/stamp-version.mjs`), builds with
   `tauri:release` (the overlay, the updater compiled in, updater artifacts signed with
   `TAURI_SIGNING_PRIVATE_KEY`), smokes the packaged app, then builds `latest.json` from the signed
   bundles. The release is published as the **latest** one, a `-beta.N` version included, because
   the app reads `releases/latest/download/latest.json` and GitHub's `latest` skips a prerelease.
   `scripts/assert-newest-release.mjs` refuses a version older than the current latest.
2. **Check.** The rail's `DesktopUpdateButton` is the one poller: thirty seconds after launch, then
   hourly, it calls `updater_check` (`updater.rs`), which reads the manifest, compares versions and
   keeps the `Update` handle. A failed check is quiet and reports "no update".
3. **Notice.** `useDesktopUpdate` holds one shared state, so three surfaces agree: `UpdateStrip`
   above the focused composer (`ComposerHeaderStrips`), the rail button, and Settings → Updates.
   Hiding the strip is remembered per version.
4. **Press.** All three go through `restartToUpdate`. The loaded UI roster supplies top-level
   running turns and non-monitor work rows. A non-empty counted set requires confirmation; otherwise
   installation starts at once. Every monitor row is excluded, including stream watches that cannot
   survive restart, so the count is not a complete runtime inventory.
5. **Install.** UI state becomes `installing`; the native command holds runtime respawns and invokes
   `download_and_install`, with throttled progress and signature verification. On macOS and Linux
   installation completes before bounded `leave_cleanly` and `app.restart()`. Windows uses the
   updater's pre-exit hook to leave cleanly before the installer handoff.
6. **Relaunch.** The new runtime backs up a database with migration history and pending upgrades
   beside its database file under `backups/migrations`, then runs the migrations. Old-backup cleanup
   is best-effort and targets all but the two newest for that filename.
7. **Failure.** A returned install error releases the respawn hold; the UI clears `installing` and
   reports the reason. This does not prove that the installer made no changes or rolled them back.

A build without `LOCALIX_UPDATER_ENABLED` skips all of it: `UPDATER_ENABLED` is false, the init
script sets `__LOCALIX_UPDATER=false`, and the page never polls or shows a notice.

Development takes a different path. Tauri's `beforeDevCommand` stages build-script prerequisites,
then the shared supervisor starts the API watcher and Vite process while the native shell loads the
development URL.

The production UI keeps editor, diff, terminal, HITL, and contributed workbench renderers behind
surface-local dynamic imports. The generated `index.html` is the startup-graph authority: the build
counts that document, its entry module, static module preloads, and startup stylesheet against both
a 269-file and 2,050,000-byte uncompressed budget. This guards first paint without merging small
chunks in ways that can pull a lazy Monaco or workbench dependency back into startup.

### Keeping the runtime alive

The shell supervises its API child in `sidecar.rs`, with the policy in `supervisor.rs`. A runtime
that dies after it was ready is started again, and what is shown while it is down is the `starting`
status, so reads wait at the page's readiness barrier instead of failing. The page reloads onto the
new port, which is deliberate: whatever the dead runtime was running is gone, and a reload is the
one way to be sure the page shows nothing it left behind.

How often is a sliding window: five restarts within three minutes, with pauses of about 0.5, 1, 2, 4
and 8 seconds, spread by up to a quarter either way. A runtime that stays up for the window gets a
fresh budget, so an occasional crash is always recovered, while one that crashes in a loop is given
up on and reported with its last output. This replaced a single restart per shell lifetime, after
which the second crash left a window with no backend until the person quit by hand.

A runtime that is alive but silent was never noticed, because the shell only watched for an exit.
Once the runtime is ready, the shell asks `/health` every five seconds with a three second limit. A
`503 draining` counts as an answer, because the shutdown path owns that case. Four unanswered checks
in a row, about twenty seconds, mark the runtime hung: it is ended and takes the same path as a
crash. A gap between beats much longer than five seconds is a sleeping machine and forgives the
count.

Ending a process never goes through `CommandChild::pid` or `kill`. Both take an inner lock that the
plugin's wait thread keeps while the child is stopped, so they can block for good on a suspended
runtime. The shell records the pid at spawn and ends the process by signal on Unix, or by closing
its Job Object on Windows. `bun run --cwd apps/desktop-tauri tauri:resilience` replays all of it
against a built app: three crashes, a freeze, and a quit that must leave nothing running.

## Limits

- A source build has no updater unless the release overlay enables and compiles it. Release
  configuration alone does not prove that a signed update is published.
- A clean quit flushes registered pending writes. A crash can lose state since the last flush.
- Recovery starts a fresh runtime and reloads the page; it does not resume the dead process's jobs.
- Process-tree cleanup uses signals on Unix and a Job Object on Windows. A Windows child launched by
  Localix ends with that job unless it explicitly leaves it.

## Related guides

- [Desktop packaging and launcher](desktop-as-primary-artifact.md)
- [Installation and updates](../getting-started/installation.md)
- [Startup troubleshooting](../getting-started/troubleshooting.md)

## Source of truth

- [Quit handshake](../../apps/desktop-tauri/src-tauri/src/quit.rs)
- [UI pending-write flush registry](../../apps/ui/src/shared/lib/quitFlush.ts)
- [Sidecar lifecycle](../../apps/desktop-tauri/src-tauri/src/sidecar.rs)
- [Restart budget and health probes](../../apps/desktop-tauri/src-tauri/src/supervisor.rs)
- [Process-tree cleanup](../../apps/desktop-tauri/src-tauri/src/process_tree.rs)
- [Desktop updater](../../apps/desktop-tauri/src-tauri/src/updater.rs)
- [Resilience verification](../../apps/desktop-tauri/scripts/check-resilience.mjs)
- [UI startup budget](../../scripts/check-ui-startup-budget.mjs)

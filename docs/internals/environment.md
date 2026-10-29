# Environment variables

Localix reads a small environment contract for process startup, runtime diagnostics, and source
development. Use this page when launching the API, repairing shell discovery, or auditing a
process-level override.

## Terminology

| Term               | Meaning                                                        | Boundary                                                       |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------- |
| Boot configuration | Values parsed once by `loadEnv()` before services are created. | Invalid values stop startup; they are not live-reloaded.       |
| Runtime override   | A value read through `envFlag`, `envInt`, or `envString`.      | Most are diagnostics, compatibility inputs, or launcher seams. |
| Machine variable   | An operating-system value such as `PATH`, `HOME`, or `SHELL`.  | Localix consumes it but does not define its vocabulary.        |
| Child output       | A variable Localix sets for a spawned hook, plugin, or server. | It is not ambient Localix configuration.                       |

## What you can do

| Need                              | Mechanism                                                         | Boundary                                                               |
| --------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Bind the API                      | Set `HOST` and `PORT` before startup.                             | The default is loopback on port `5051`; port `0` requests a free port. |
| Relocate persisted state          | Set `LOCALIX_DB_FILE` before the database opens.                  | Row-owned blobs follow the database directory; machine keys do not.    |
| Repair agent-shell discovery      | Point `LOCALIX_SHELL` at an existing Bash executable.             | Windows agent commands require Bash; PowerShell is not a fallback.     |
| Bound MCP startup and tool calls  | Set the MCP timeout variables in milliseconds.                    | Values below `1000` are ignored.                                       |
| Diagnose runtime policy           | Enable one of the `LOCALIX_*` developer flags below.              | These flags have no Settings surface and usually require a restart.    |
| Move source-development listeners | Set the `LOCALIX_DEV_*` values used by `scripts/dev-servers.mjs`. | They affect `bun run dev`, not a packaged desktop launch.              |

## How it works

[`apps/api/src/lib/env.ts`](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/env.ts)
owns API-side parsing. `loadEnv()` validates the boot schema, while three shared readers normalize
values used deeper in the runtime:

| Reader                    | Accepted value                                       | Fallback behavior                                       |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `envFlag(name, fallback)` | `1`, `true`, `yes`, `on`, or their false equivalents | Blank or unknown text returns `fallback`.               |
| `envInt(name, fallback)`  | A finite positive number, truncated to an integer    | Blank, zero, negative, or non-numeric returns fallback. |
| `envString(name)`         | Non-empty text after trimming                        | Blank returns `undefined`.                              |

[`apps/api/src/lib/env-contract.test.ts`](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/env-contract.test.ts)
scans `apps/api/src` for direct reads of named variables. It permits operating-system variables and
three dynamic-name boundaries: login-shell repair, hook interpolation, and manifest-declared MCP
child environment values.

`localixHome()` derives `~/.localix` from `os.homedir()`. The default database is
`~/.localix/localix.db`; media and other row-owned blobs use its directory, while vault and MCP
OAuth key material remain under the machine-level Localix home.

Session-owned mini app data uses `~/.localix/session-data` with the default database. An alternate
`LOCALIX_DB_FILE` uses `<absolute database filename>.session-data` instead, so databases in the same
directory still have separate session data. The startup orphan sweep reconciles only that database's
data root; a test database cannot remove the default database's mini app state.
[`session-storage.ts`](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/session-storage.ts)
owns this path selection.

Detached children the API tracks (the local model servers, background jobs, terminals) are reaped
even when the API is killed with SIGKILL, which runs no exit handler. While the orphan guard is
installed, each API process records the process groups it tracks in `~/.localix/run/api.<pid>.pids`
(with each leader's start time, so a recycled pid is never killed). A one-second `sh` watchdog in
its own process group SIGKILLs those groups and removes the file once the API pid is gone; the next
API start does the same for any file whose API is dead, which is also how Windows (no watchdog)
recovers. A clean exit removes the file.
[`orphan-guard.ts`](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/orphan-guard.ts)
owns this.

The login-shell resolver captures the user's interactive shell environment for GUI launches.
Child-process helpers pass that repaired environment explicitly to Git, language servers, MCP
servers, and agent commands.

| Step         | Behavior                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Cache        | A snapshot per fingerprint (shell, starting `PATH`, rc files) in `~/.localix/login-shell-env.json`.          |
| Eviction     | Up to 8 snapshots, least recently used first, so terminal launches cannot push out the GUI launch's entry.   |
| Probe        | On a miss, `-ilc` then `-lc` share one 3 s budget; a timeout kills the probe's process group with SIGKILL.   |
| Failure      | A probe that yields nothing is recorded for its fingerprint for 24 hours instead of rerunning on each boot.  |
| Boot         | The probe runs after bind without delaying readiness; the backend host, engines and timers wait for it.      |
| Logging      | `startup.env_ready` records the wait in `ms` and whether a snapshot answered (`cache`: `hit` or `miss`).     |
| Early spawns | A spawn while the probe is in flight resolves the environment synchronously rather than use a partial one.   |
| AppImage     | Values the AppImage runtime pointed into its mount (`LD_LIBRARY_PATH`, GTK/GIO/GStreamer paths) are removed. |

The resolver lives in `apps/api/src/lib/login-shell-env.ts`, its snapshot file in
`apps/api/src/lib/login-shell-snapshot.ts`, the spawn in `apps/api/src/lib/login-shell-probe.ts`,
and the AppImage filter in `apps/api/src/lib/appimage-env.ts`.

## Configuration

### API boot configuration

| Variable                  | Default                 | Effect                                                                                  |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `PORT`                    | `5051`                  | API listen port; non-negative integer.                                                  |
| `HOST`                    | `127.0.0.1`             | API bind address.                                                                       |
| `LOG_LEVEL`               | `info`                  | `debug`, `info`, `warn`, or `error`.                                                    |
| `LOCALIX_DB_FILE`         | `~/.localix/localix.db` | SQLite database and row-owned blob root.                                                |
| `LOCALIX_DEFAULT_USER_ID` | `local-user`            | Identifier for the single-user runtime.                                                 |
| `LOCALIX_UI_DIR`          | unset                   | Prebuilt UI directory served by the API.                                                |
| `LOCALIX_UI_ORIGINS`      | unset                   | Comma-separated exact page origins allowed to call the API.                             |
| `LOCALIX_MODELS_DIR`      | `~/.localix/models`     | Local models, their runtime and the model server's presets.                             |
| `HF_TOKEN`                | unset                   | A Hugging Face token for the local-model catalog: higher API rate limits, gated models. |
| `LOCALIX_CLI_ENTRY`       | unset                   | Staged `localix` launcher used by shell-command installation.                           |

`LOCALIX_UI_ORIGINS` adds to the packaged app's origins; it accepts only exact `http` or `https`
origins, and an invalid entry stops startup. `scripts/dev-servers.mjs` sets it to the Vite origin. A
`HOST` that names a concrete address is also accepted as a request `Host`; a wildcard bind accepts
only loopback names. The "Local API browser boundary" section of the desktop internals page
(`docs/internals/desktop-as-primary-artifact.md`) describes the boundary.

### Agent shell and MCP

| Variable                | Default             | Effect                                                                                         |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `LOCALIX_SHELL`         | detected            | Existing shell file; wins over the legacy override. Automatic Windows lookup skips WSL `bash`. |
| `LOCALIX_BASH_PATH`     | detected            | Legacy Bash-path spelling.                                                                     |
| `MAX_MCP_OUTPUT_TOKENS` | built-in text limit | Converts the positive token value to a character cap at four characters per token.             |
| `MCP_TIMEOUT`           | `30000`             | MCP connection and `tools/list` timeout in milliseconds.                                       |
| `MCP_TOOL_TIMEOUT`      | `30000`             | Per-call timeout after a server-specific `timeout` value.                                      |

Blank shell overrides count as unset. A nonblank invalid `LOCALIX_SHELL` falls through to automatic
shell discovery without trying `LOCALIX_BASH_PATH`. Overrides check file existence, not executable
permissions or Bash identity. The selected shell is cached until API restart. The
[execution-environment guide](../features/execution-environments.md) documents platform fallbacks.

A tool's `anthropic/maxResultSizeChars` annotation takes precedence over `MAX_MCP_OUTPUT_TOKENS`,
subject to the host annotation cap. The [MCP guide](../features/mcp.md) owns server configuration
and result-shaping details.

### Runtime and diagnostic flags

| Variable                            | Default | Effect                                                            |
| ----------------------------------- | ------- | ----------------------------------------------------------------- |
| `LOCALIX_CACHE_DIAGNOSTICS`         | off     | Computes the per-run prompt-cache diagnostic snapshot.            |
| `LOCALIX_DISABLE_IMAGE_DOWNSCALE`   | off     | Bypasses run-time image downscaling.                              |
| `LOCALIX_EDIT_PREDICTION_TELEMETRY` | off     | Writes metadata-only edit-prediction outcomes to the process log. |
| `LOCALIX_FREEZE_CONTEXT`            | on      | Freezes the session context snapshot; `0` disables it.            |
| `LOCALIX_MID_RUN_INTERJECT`         | on      | Drains queued user text at safe points in an active run.          |

The wire dump is controlled by `~/.localix/wire-dump.on`, not an environment variable. A file toggle
can change a running development process without restarting it.

### Launcher and source-development seams

| Variable                     | Default            | Owner and effect                                                  |
| ---------------------------- | ------------------ | ----------------------------------------------------------------- |
| `LOCALIX_RUNTIME_WATCH`      | off                | API daemon development-watch mode.                                |
| `LOCALIX_RUNTIME_HOST`       | `127.0.0.1`        | Host requested by the daemon launcher.                            |
| `LOCALIX_DAEMON_LOG`         | derived            | API log-file override; default `logs/api.log` beside the DB.      |
| `LOCALIX_LAUNCH_ID`          | set by the shell   | Launch id the API stamps on every log line (`bun run logs`).      |
| `LOCALIX_DESKTOP_PARENT_PID` | unset              | Stops the desktop runtime after its owner exits or closes stdin.  |
| `LOCALIX_MINI_APP_KIT_DIR`   | self-located       | Mini app kit root behind `GET /rpc/mini-apps/kit`; dev stages it. |
| `LOCALIX_TRASH_DIR`          | `~/.localix/trash` | Recoverable-delete root; tests override it.                       |
| `LOCALIX_DEV_API_PORT`       | `5051`             | API port used by `scripts/dev-servers.mjs`.                       |
| `LOCALIX_DEV_UI_PORT`        | `5050`             | Vite port and preflight port used by source development.          |
| `LOCALIX_DEV_HOST`           | `127.0.0.1`        | API host used by source development.                              |
| `VITE_DEV_HOST`              | unset              | Optional Vite bind address, including container access.           |
| `VITE_API_BASE_URL`          | launcher-set       | Required API proxy target when Vite serves.                       |
| `VITE_WS_BASE_URL`           | launcher-set       | Direct WebSocket base injected into the UI.                       |

### Terminal notification overrides

| Variable                         | Values                          | Boundary                                                  |
| -------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `LOCALIX_TERMINAL_NOTIFICATIONS` | `auto`, `osc9`, `osc777`, `bel` | Read by the terminal transport; `off` or `0` disables it. |

## Limits

- The raw-read lint covers `apps/api/src`, because other workspaces cannot import an API-internal
  module. The CLI, Vite, desktop build scripts, and release scripts own separate boundaries.
- This page documents runtime and source-development inputs. CI signing, release-manifest, and
  test-only variables remain contracts of their owning scripts.
- Environment values are process-level inputs. Provider credentials belong in provider connections,
  plugin and mini app secrets in declared secret configuration, and user preferences in Settings.
- `LOCALIX_MINI_APP_KIT_DIR`, `LOCALIX_TRASH_DIR`, and desktop runtime variables are launcher or
  test seams, not stable end-user controls.
- A blank or invalid flag silently uses its fallback. Startup schema errors are the exception:
  invalid boot configuration stops API creation.

## Related guides

- [Execution environments](../features/execution-environments.md)
- [MCP](../features/mcp.md)
- [Notifications](../features/notifications.md)
- [Secrets](../features/secrets.md)

## Source of truth

- [Environment schema and readers](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/env.ts)
- [Raw-read contract test](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/env-contract.test.ts)
- [Login-shell environment repair](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/login-shell-env.ts)
- [Agent shell selection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/environments/shell.ts)
- [MCP timeout policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/mcp-tools.ts)
- [MCP result cap](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/mcp-result.ts)
- [Source-development launcher](https://github.com/rsaryev/localix/blob/main/scripts/dev-servers.mjs)

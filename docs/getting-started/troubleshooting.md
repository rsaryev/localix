# Diagnose Localix

This guide isolates failures across the desktop shell, local API, session model, project tools, and
mini app workbenches. Use it to identify the failing boundary before changing credentials or project
state.

## What you can do

| Symptom                               | First check                                                               | Owning guide                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Source build does not open            | Read the first error from `bun run dev`                                   | [Installation](installation.md)                                                             |
| Session will not run                  | Resolve its provider connection and model in **Settings → Diagnostics**   | [Providers and models](../features/providers.md)                                            |
| A tool is missing or denied           | Inspect the project, effective tool list, and permission summary          | [Capabilities](../features/capabilities.md)                                                 |
| A workbench is absent                 | Check its project-scoped state in **Settings → Capabilities → Mini apps** | [Mini apps](../features/mini-apps.md)                                                       |
| A workbench cannot reach a dependency | Test the daemon, cluster, database, or network independently              | [DevOps Workspace](../features/devops.md) and [Database workbench](../features/database.md) |

### Terms used in this guide

| Term                        | Meaning                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| **Desktop shell**           | The native application process that owns the window and packaged API child              |
| **Local API**               | The backend process that owns sessions, tools, providers, extensions, and project state |
| **Effective configuration** | The read-only result of resolving model routes, installed extensions, and agent rules   |
| **Workbench**               | A workspace surface for files, data, or tools; some are supplied by mini apps           |

## How it works

### The source build does not open

Install the locked workspace dependencies, then start the complete development process from the
repository root:

```bash
bun install --frozen-lockfile
bun run dev
```

The launcher checks for a live process registered against the selected database, then probes both
IPv4 and IPv6 loopback addresses for frontend/API port conflicts. A database-ownership error names a
PID; a port error names the port and address. Identify the listener, close the Localix or dev
process you intended to stop, then retry. A non-responsive but live registered process still blocks
that database's development launch.

A built app run from inside Documents, Desktop or Downloads (a checkout's `target/` folder, for
example) needs macOS folder access before its local API can read its own files. Until that prompt is
answered the API cannot start, and the app reports that it "never got to run its code". Allow the
access, or move the app to Applications. A locally built app is signed per build, so macOS may ask
again after a rebuild. Review denied access in macOS privacy settings; a release build does not
guarantee that permissions can never be requested again. See
[Apple's file-access policy](https://support.apple.com/guide/security/controlling-app-access-to-files-secddd1d86a6/web).

### A session has no runnable model

Open **Settings → Diagnostics**, select the project and session, and inspect the **Chat sessions**
consumer. The Session id field accepts a typed identifier, not a session picker. Leaving Project at
**No project** lets the backend use the session's project; choosing a project explicitly overrides
that scope while the report still uses the specified session's model. Keep those selections
consistent when investigating a session.

A direct run requires an effective model and a usable connection. The model can be inherited from
agent preferences or project defaults; an explicit session selection is not required.

Use the model picker to choose a live connection and one of that provider's catalog models. The
runtime may resolve another usable connection for the same provider; it does not cross to a
different provider or model.

### A project tool is missing or blocked

Confirm that the session points to the intended project. Then use **Settings → Diagnostics** to
inspect its tool surface and permission summary. The current capability report resolves the default
agent, and a session model report follows its main participant; it is not a complete per-participant
trace. Check the intended agent's **Settings → Capabilities** as well.

Capability rules can narrow tools or require confirmation. The agent's own tool set, project
settings, mini apps, plugins, skills, and host dependencies can narrow the surface further. Change
the owning setting, then ask the agent to retry the action.

### A workbench is missing or disconnected

Open **Settings → Capabilities → Mini apps** in the intended project scope, or run `/mini-app list`
in a chat of that project. An inactive mini app contributes neither its gated workbench views nor
its model-facing tools. `/mini-app enable <name>` turns one back on.

For a visible workbench that cannot connect, test its external dependency separately:

| Workbench | External boundary                                                       | Guide                                         |
| --------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| DevOps    | Docker-compatible daemon, kubeconfig, cluster authentication, and RBAC  | [DevOps Workspace](../features/devops.md)     |
| Database  | Database host, port, TLS settings, credentials, and optional SSH tunnel | [Database workbench](../features/database.md) |
| Documents | Supported input format, parser limits, and generator output format      | [Documents](../features/documents.md)         |

### Read the logs of one launch

The desktop shell and interface reports write JSON lines to `~/.localix/logs/desktop.log`; the API
writes to `logs/api.log` beside the active database, normally `~/.localix/logs/api.log`.
`LOCALIX_DAEMON_LOG` overrides the API destination. The normal source-development database therefore
uses `.data/dev/logs/api.log`, while desktop logs still use the user-home directory. Processes
launched by the desktop share its launch ID. Standalone development API entries can have no launch
ID. Each log keeps one rotated generation (`.old`). Desktop rotation checks a 2 MiB threshold while
writing; API rotation checks an 8 MiB threshold only at process startup, so a long-running API can
exceed it. Rotation is best-effort, and older retained generations are replaced.

From a source checkout, use these commands:

```bash
bun run logs
bun run logs --launches
bun run logs --all --source api --level warn
bun run logs --dir .data/dev/logs --all --source api
bun run logs --startup --last 15
```

The default selects the latest recorded launch; `--all` includes entries without a launch ID.
`--launch <id>` selects a launch, `--source api,ui` selects sources, and `--level warn` includes
that severity and above. `--json` prints normalized timeline entries; it does not export the
original line unchanged. `--dir <folder>` reads a different log directory.

The startup report measures from the shell's `setup entered` event to the window, local service,
first paint, workspace, and mini apps. It omits launches without that start event and shows a dash
for missing milestones. `--last` limits displayed rows (default 15); median, 90th percentile, and
worst-case summaries still use all retained qualifying launches for each milestone. Startup and
launch-list reports use their own text format rather than `--json` output.

A slow launch alone does not identify the cause. Compare its milestone gaps and API events before
attributing it to an update, file scanning, database migration, or a dependency.

A slow start names its own cost in the API log. `startup.env_ready` gives the wait for the
login-shell environment and whether a cached snapshot answered it (`cache`). Maintenance that no
first request needs runs one job at a time after an initial delay and a quiet-event-loop check.
After the maximum wait, it proceeds even without a quiet period. Each job logs `startup.idle_tasks`
with its `task` name and `ms`.

### The data folder takes a lot of disk

The default installed-app database is `~/.localix/localix.db`. Conversation messages, tool-output
artifacts, configuration, indexes, and other records contribute to its size. Growth depends on the
workload; the source development runtime normally uses `.data/dev/localix.db` instead. Check the
active database before diagnosing disk usage.

Tool outputs of at least 4 KiB are eligible for zstd compression. The compressed form is kept only
when it saves more than 10%; incompressible outputs remain plaintext. Startup maintenance converts
older outputs in batches and sweeps orphan search chunks. Existing databases can switch to
incremental auto-vacuum through a rewrite; the implementation requires at least 1.5 times the
current database size in free space, and skips conversion with a log entry when space is
insufficient.

Maintenance reclaims free pages and requests a WAL checkpoint. Active readers can delay the
checkpoint, and these operations do not guarantee an immediately empty WAL or a specific file-size
reduction. Each pass logs `storage.maintained` with its results.

History itself is removed only when you ask. **Settings → System → Storage** shows what the data
takes on disk and what it is made of. Pick an age and choose Review to count the conversations with
no message for that long and the history they hold, then Remove to delete them after a confirmation.
Eligibility checks the root conversation's last-message time, pin, and running status. An eligible
root is removed together with its descendants. Child activity, pins, and status do not independently
exclude the tree; deletion stops its running children. Review the whole conversation before removing
it or enabling retention.

The same section can remove them automatically: choose a window under "Remove automatically" and the
daily maintenance pass deletes what has gone quiet for that long. It is off until you choose one,
and the shortest window is 30 days in the menu (the API accepts seven).

The section is a front for two routes: `GET /rpc/storage/usage` reports the file, the write-ahead
log, free pages and the bytes held by messages and tool outputs, and `POST /rpc/storage/prune` takes
an integer `olderThanDays` from 7 to 3650 and an explicit `dryRun` boolean. Review is a count, not a
reservation: removal selects candidates again. Roots delete independently, so a failed delete does
not undo successful ones. The reported history size is an estimate of candidate content, not
guaranteed reclaimed disk space.

### Report a reproducible failure

Record the Localix version or commit, operating system and architecture, smallest reproduction,
expected result, observed result, and the relevant sanitized diagnostic. Remove project paths,
credentials, provider responses, private source, and database contents before sharing it.

Report suspected vulnerabilities through the private process in
[SECURITY.md](https://github.com/rsaryev/localix/blob/main/SECURITY.md).

## Configuration

| Control                                 | Effect                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `bun run dev`                           | Starts the desktop development process from the repository root                   |
| `LOCALIX_DEV_UI_PORT`                   | Overrides the development frontend port; default is `5050`                        |
| `LOCALIX_DEV_API_PORT`                  | Overrides the development API port; default is `5051`                             |
| **Settings → Diagnostics**              | Resolves models, tools, permissions, and validation messages for a selected scope |
| **Settings → Capabilities → Plugins**   | Shows and changes the Claude Code plugin state for the selected project scope     |
| **Settings → Capabilities → Mini apps** | Shows and changes the mini app state for the selected project scope               |
| Model picker                            | Binds a provider connection and model to the current session                      |
| **Settings → Capabilities**             | Edits the selected agent's tool availability and permission rules                 |

## Limits

- **Settings → Diagnostics** needs a reachable local API. It cannot explain a backend process that
  failed before the interface opened.
- The effective-configuration report does not return vault values or provider credentials. It does
  return resolved settings, which can include `customSystemPrompt`, paths, permission messages, and
  other private text. Review the response and screenshots before sharing; configuration text is not
  a general secret-scanning boundary.
- Diagnostics validates declared workload assignments and capability configuration. It does not
  prove which model, effort, or tool set a specific participant will use; consult the
  [provider workload boundaries](../features/providers.md#which-model-a-participant-runs-on).
- A successful structural model selection does not prove that provider authentication, quota, or
  network access will succeed on the next request.
- Changing an agent's rules or mini app or plugin availability does not replay a completed denial.
  Retry the action after the new configuration resolves.
- Localix cannot repair an unavailable daemon, invalid kubeconfig, database authorization failure,
  provider outage, or blocked network route.
- Diagnostics and screenshots can still contain project names, paths, prompts, or provider error
  text. Sanitize them before sharing.

## Related guides

- [Installation](installation.md)
- [Providers and models](../features/providers.md)
- [Capabilities](../features/capabilities.md)
- [Permissions reference](../features/permissions.md)
- [Privacy](privacy.md)

## Source of truth

- [Development startup and port checks](https://github.com/rsaryev/localix/blob/main/scripts/dev-servers.mjs)
- [Log timeline CLI](https://github.com/rsaryev/localix/blob/main/scripts/logs.mjs)
- [API log destination and rotation](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/runtime-log-destination.ts)
- [Desktop logging](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/log.rs)
- [Idle task scheduler](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/idle-tasks.ts)
- [Storage maintenance](https://github.com/rsaryev/localix/blob/main/apps/api/src/bootstrap/storage-maintenance.ts)
- [Storage service](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/storage/service.ts)
- [Desktop API child](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/sidecar.rs)
- [Effective-configuration report](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/ui/DiagnosticsSettings.tsx)
- [Effective-configuration service](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/effective-config/service.ts)
- [Diagnostics host scope](https://github.com/rsaryev/localix/blob/main/apps/api/src/bootstrap/app-services.ts)
- [Direct-run model requirements](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/stages/turn.ts)
- [Agent-owned permission policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-engine.ts)
- [Permission decisions](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-gate.ts)
- [Plugin activation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/enable.ts)
- [Mini app activation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/catalog.ts)

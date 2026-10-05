# Diagnose Localix

This guide isolates failures across the desktop shell, local API, session model, project tools, and
plugin workbenches. Use it to identify the failing boundary before changing credentials or project
state.

## What you can do

| Symptom                               | First check                                                             | Owning guide                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Source build does not open            | Read the first error from `bun run dev`                                 | [Installation](installation.md)                                                             |
| Session will not run                  | Resolve its provider connection and model in **Settings → Diagnostics** | [Providers and models](../features/providers.md)                                            |
| A tool is missing or denied           | Inspect the project, effective tool list, and permission summary        | [Capabilities](../features/capabilities.md)                                                 |
| A workbench is absent                 | Check its project-scoped state in **Settings → Capabilities → Plugins** | [Plugins](../extending/plugins.md)                                                          |
| A workbench cannot reach a dependency | Test the daemon, cluster, database, or network independently            | [DevOps Workspace](../features/devops.md) and [Database workbench](../features/database.md) |

### Terms used in this guide

| Term                        | Meaning                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| **Desktop shell**           | The native application process that owns the window and packaged API child            |
| **Local API**               | The backend process that owns sessions, tools, providers, plugins, and project state  |
| **Effective configuration** | The read-only result of resolving model routes, installed extensions, and agent rules |
| **Workbench**               | A project-scoped UI and tool contribution supplied by an enabled plugin               |

## How it works

### The source build does not open

Install the locked workspace dependencies, then start the complete development process from the
repository root:

```bash
bun install --frozen-lockfile
bun run dev
```

The launcher checks whether another Localix runtime owns the same database and whether its frontend
or API port is occupied. Stop the process named in that error, then run the command again.

A built app run from inside Documents, Desktop or Downloads (a checkout's `target/` folder, for
example) needs macOS folder access before its local API can read its own files. Until that prompt is
answered the API cannot start, and the app reports that it "never got to run its code". Allow the
access, or move the app to Applications. A locally built app is signed per build, so macOS may ask
again after every rebuild; a released build asks once.

### A session has no runnable model

Open **Settings → Diagnostics**, select the project and session, and inspect the **Chat sessions**
consumer. A direct run requires both a provider connection and model on the session.

Use the model picker to choose a live connection and one of that provider's catalog models. The
runtime may resolve another usable connection for the same provider; it does not cross to a
different provider or model.

### A project tool is missing or blocked

Confirm that the session points to the intended project. Then use **Settings → Diagnostics** to
inspect the resolved tool surface and permission summary for that project and session.

Capability rules can narrow tools or require confirmation. The agent's own tool set, project
settings, plugins, skills, and host dependencies can narrow the surface further. Change the owning
setting, then ask the agent to retry the action.

### A workbench is missing or disconnected

Open **Settings → Capabilities → Plugins** in the intended project scope. An inactive plugin
contributes neither its gated workbench views nor its model-facing tools.

For a visible workbench that cannot connect, test its external dependency separately:

| Workbench | External boundary                                                       | Guide                                         |
| --------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| DevOps    | Docker-compatible daemon, kubeconfig, cluster authentication, and RBAC  | [DevOps Workspace](../features/devops.md)     |
| Database  | Database host, port, TLS settings, credentials, and optional SSH tunnel | [Database workbench](../features/database.md) |
| Documents | Supported input format, parser limits, and generator output format      | [Documents](../features/documents.md)         |

### Read the logs of one launch

Every Localix process logs to `~/.localix/logs`: the desktop shell and what the interface reports to
`desktop.log`, the local API to `api.log`. Each line is one JSON object that names its source and
the launch it belongs to, so one launch can be followed from the window opening to the API
answering. From a source checkout, `bun run logs` prints the last launch as one timeline;
`--launches` lists the launches still in the logs, and `--launch <id>`, `--source`, `--level` and
`--json` narrow it. Each file keeps one rotated generation (`.old`).

`bun run logs --startup` answers "how long does Localix take to open?" across launches: for each
one, the milliseconds from the shell's start to the window, the local service answering, the first
paint, the workspace and the plugins, then the median, 90th percentile and worst case. A launch much
slower than the median is usually the first start after an update, which scans the new files and
migrates the database.

A slow start names its own cost in the API log. `startup.env_ready` gives the wait for the
login-shell environment and whether a cached snapshot answered it (`cache`). Maintenance that no
first request needs runs one job at a time once the app is idle, and each job logs
`startup.idle_tasks` with its `task` name and `ms`.

### The data folder takes a lot of disk

Almost all of `~/.localix/localix.db` is conversation history: every message, and the full output of
every tool call, is kept so a session can be reopened and searched exactly as it ran. A busy workday
adds on the order of ten megabytes.

Localix keeps that growth in check without deleting anything. Tool outputs over 4 KiB are stored
compressed (zstd), and a pass shortly after start converts the ones written by older versions in
small batches. The database uses incremental auto-vacuum, so space freed by a deletion goes back to
the disk instead of staying inside the file; an existing database is switched once, with a full
rewrite that needs about its own size in free space and is skipped, with a log line, when there is
not enough. The write-ahead log is emptied after that pass and when the app stops. Search sections
that belonged to a deleted conversation are removed with it. Each pass logs `storage.maintained`
with what it changed.

History itself is removed only when you ask. **Settings → General → Storage** shows what the data
takes on disk and what it is made of. Pick an age and choose Review to count the conversations with
no message for that long and the history they hold, then Remove to delete them after a confirmation.
Pinned and running conversations are never touched, and a conversation goes together with its
sub-agent sessions. The same section can remove them automatically: choose a window under "Remove
automatically" and the daily maintenance pass deletes what has gone quiet for that long. It is off
until you choose one, and the shortest window is 30 days in the menu (the API accepts seven).

The section is a front for two routes: `GET /rpc/storage/usage` reports the file, the write-ahead
log, free pages and the bytes held by messages and tool outputs, and `POST /rpc/storage/prune` takes
`olderThanDays` (at least 7) and `dryRun`.

### Report a reproducible failure

Record the Localix version or commit, operating system and architecture, smallest reproduction,
expected result, observed result, and the relevant sanitized diagnostic. Remove project paths,
credentials, provider responses, private source, and database contents before sharing it.

Report suspected vulnerabilities through the private process in
[SECURITY.md](https://github.com/rsaryev/localix/blob/main/SECURITY.md).

## Configuration

| Control                               | Effect                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `bun run dev`                         | Starts the desktop development process from the repository root                   |
| `LOCALIX_DEV_UI_PORT`                 | Overrides the development frontend port; default is `5050`                        |
| `LOCALIX_DEV_API_PORT`                | Overrides the development API port; default is `5051`                             |
| **Settings → Diagnostics**            | Resolves models, tools, permissions, and validation messages for a selected scope |
| **Settings → Capabilities → Plugins** | Shows and changes the plugin state for the selected project scope                 |
| Model picker                          | Binds a provider connection and model to the current session                      |
| **Settings → Capabilities**           | Edits the selected agent's tool availability and permission rules                 |

## Limits

- **Settings → Diagnostics** needs a reachable local API. It cannot explain a backend process that
  failed before the interface opened.
- The effective-configuration report does not return secret values, connection credentials, or the
  raw system prompt.
- A successful structural model selection does not prove that provider authentication, quota, or
  network access will succeed on the next request.
- Changing an agent's rules or plugin availability does not replay a completed denial. Retry the
  action after the new configuration resolves.
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
- [Storage maintenance](https://github.com/rsaryev/localix/blob/main/apps/api/src/bootstrap/storage-maintenance.ts)
- [Storage service](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/storage/service.ts)
- [Desktop API child](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/sidecar.rs)
- [Effective-configuration report](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/ui/DiagnosticsSettings.tsx)
- [Direct-run model requirements](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/stages/turn.ts)
- [Agent-owned permission policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-engine.ts)
- [Permission decisions](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-gate.ts)
- [Plugin activation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/enable.ts)

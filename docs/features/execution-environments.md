# Execution environments

Execution environments are the adapters Localix uses for agent file I/O, shell commands, and ripgrep
searches. Sessions currently select the local adapter, so these operations run on the machine
hosting the Localix API.

**Availability:** SSH and Docker adapter classes exist as groundwork. No supported product surface
can select or configure them for a session.

## What you can do

| Operation             | Local mechanism                                                   | Boundary                                                                          |
| --------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Read files            | Node file I/O returns UTF-8 content and accepts run cancellation. | The read operates on the API host, within the tool's permission policy.           |
| Write full files      | A temporary sibling is renamed over the destination.              | `write`, `edit` and `apply_patch` use this adapter; permission rules still apply. |
| Run shell commands    | The foreground `bash` path starts the resolved local shell.       | Commands are local processes, not operating-system-sandboxed workloads.           |
| Search file contents  | The adapter starts local `rg` with the shared search arguments.   | `rg` must be installed and visible to the API process.                            |
| Resolve working paths | Relative paths use the session workspace.                         | An absolute tool path remains absolute and can trigger outside-workspace rules.   |

## How it works

The session record stores `executionBackend` and `executionTarget`. Runtime tool assembly and
session file operations translate those fields into the same environment contract:

| Adapter  | Implemented mechanism                                                                 | Product reachability                                  |
| -------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `local`  | Node file I/O, atomic full-file writes, local Bash, and local `rg`                    | Selected for every supported new or external session. |
| `ssh`    | Host `ssh`, remote `bash -c`, port 22 from session routing, and remote `rg`           | No supported session path selects this adapter.       |
| `docker` | Host `docker exec`, commands in one named existing container, and container-side `rg` | No supported session path selects this adapter.       |

New sessions and externally created sessions store `local`. Public create and update schemas expose
neither execution field. A fork copies its source session's stored fields, but there is no supported
operation that writes a remote value first.

Local full-file writes use a temporary file and rename, so concurrent readers do not observe a
partial result. Shell and search calls pass cancellation and configured timeouts to their child
processes.

## Configuration

| Variable            | Precedence | Behavior                                                                   |
| ------------------- | ---------- | -------------------------------------------------------------------------- |
| `LOCALIX_SHELL`     | First      | Uses this file path when it exists.                                        |
| `LOCALIX_BASH_PATH` | Second     | Legacy fallback when `LOCALIX_SHELL` is unset.                             |
| `SHELL`             | Unix only  | Late fallback after Bash lookup; Windows still requires a Bash executable. |

On Unix-like systems, Localix checks Bash on `PATH`, `/bin/bash`, and `/usr/bin/bash` before the
`SHELL` fallback. On Windows, it checks Bash on `PATH` and standard Git for Windows install
locations. It does not fall back to PowerShell or `cmd.exe`.

There is no supported setting, environment variable, API field, composer control, or slash command
for choosing `ssh` or `docker`. `sshHost`, `sshPort`, and `containerName` are internal adapter
configuration fields.

## Limits

- SSH and Docker are not reachable in a normal session. Persisted enum values and adapter classes do
  not establish remote-execution support.
- SSH and Docker full-file writes stream through `cat > path`. A dropped connection, stopped
  process, or timeout can leave a partially written target.
- The SSH adapter disables strict host-key checking and enables batch mode. There is no product flow
  for host verification, credentials, port selection, or connection setup.
- The Docker adapter does not create, select, mount, or manage containers. It assumes the named
  container already exists and contains the shell tools required by the operation.
- Remote paths are not host paths. Host-only operations such as revealing a file are unavailable,
  remote deletion has no Localix trash fallback, and local file watching is disabled: a local
  session's file tree follows disk on its own, while a remote one shows a **Refresh** button.
- Running Localix inside a container is a deployment question. These dormant adapters do not
  establish production self-hosting.

## Related guides

- [Permissions](permissions.md)
- [Environment variables](../internals/environment.md)
- [Sessions and projects](sessions-and-projects.md)

## Source of truth

- [Environment contract](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/environment.ts)
- [Environment factory](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/environments/index.ts)
- [Local adapter](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/environments/local.ts)
- [Dormant SSH and Docker adapters](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/environments/remote.ts)
- [Session creation default](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/session-lifecycle.ts)
- [Public session schemas](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/contracts/session.ts)
- [Session file-operation routing](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/file-ops-context.ts)

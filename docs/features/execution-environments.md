# Execution environments

Execution environments are the adapters Localix uses for agent file I/O, shell commands, and ripgrep
searches. Every session uses the local adapter, so these operations run on the machine hosting the
Localix API. There is no remote (SSH or container) execution.

## What you can do

| Operation             | Local mechanism                                                   | Boundary                                                                        |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Read files            | Node file I/O returns UTF-8 content and accepts run cancellation. | The read operates on the API host, within the tool's permission policy.         |
| Write full files      | A temporary sibling is renamed over the destination.              | `Write` and `Edit` use this adapter; permission rules still apply.              |
| Run shell commands    | The foreground `Bash` path starts the resolved local shell.       | Commands are local processes, not operating-system-sandboxed workloads.         |
| Search file contents  | The adapter starts local `rg` with the shared search arguments.   | `rg` must be installed and visible to the API process.                          |
| Resolve working paths | Relative paths use the session workspace.                         | An absolute tool path remains absolute and can trigger outside-workspace rules. |

## How it works

Local full-file writes use a temporary file and rename, so concurrent readers do not observe a
partial result. Shell and search calls pass cancellation and configured timeouts to their child
processes. Foreground execution inherits the repaired login-shell environment with a non-interactive
overlay and enabled plugins' `bin/` directories at the front of `PATH`.

Interactive terminals and PTY background jobs use the terminal service on the API host. Language
servers also run on that host; the execution adapter is not a general routing layer for every
process Localix starts.

## Configuration

| Variable            | Precedence | Behavior                                                                   |
| ------------------- | ---------- | -------------------------------------------------------------------------- |
| `LOCALIX_SHELL`     | First      | Uses this file path when it exists.                                        |
| `LOCALIX_BASH_PATH` | Second     | Legacy fallback when `LOCALIX_SHELL` is unset or blank.                    |
| `SHELL`             | Unix only  | Late fallback after Bash lookup; Windows still requires a Bash executable. |

On Unix-like systems, Localix checks Bash on `PATH`, `/bin/bash`, and `/usr/bin/bash` before the
`SHELL` fallback, then uses `sh` if none is found. On Windows, it checks Bash on `PATH`, Bash beside
the Git executable found on `PATH`, and standard Git for Windows install locations. Automatic
discovery rejects the WSL launcher. It does not fall back to PowerShell or `cmd.exe`.

Overrides must name an existing file; the resolver does not verify that it is executable or Bash. A
nonblank invalid `LOCALIX_SHELL` skips the legacy override and falls through to discovery. Shell
resolution is cached for the API process, so changing these variables requires a restart.

## Limits

- Tools never run on another machine or in a container. Running Localix itself inside a container is
  a deployment question; this guide does not establish production self-hosting.

## Related guides

- [Permissions](permissions.md)
- [Environment variables](../internals/environment.md)
- [Sessions and projects](sessions-and-projects.md)

## Source of truth

- [Environment contract](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/environment.ts)
- [Shell resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/environments/shell.ts)
- [Terminal host ports](https://github.com/rsaryev/localix/blob/main/apps/api/src/bootstrap/terminal-ports.ts)
- [Local adapter](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/environments/local.ts)
- [Session file-operation routing](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/file-ops-context.ts)

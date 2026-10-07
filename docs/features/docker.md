# Containers

Containers is the Docker-backed area of the bundled [DevOps Workspace](devops.md). Use it to inspect
host containers and related resources, run lifecycle actions, and attach runtime details to a
session.

**Availability:** The DevOps Workspace is enabled by default but can be disabled. A reachable
Docker-compatible daemon is required.

![Inspecting live logs from the running release-preview container](../assets/screenshots/devops/containers--2026-10-08.png)

## What you can do

| Capability              | Mechanism                                                                                      | Boundary                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Inspect containers      | Open logs, CPU and memory stats, network and block I/O, and process rows.                      | Stats and process data depend on what the daemon reports for the selected container.               |
| Manage containers       | Start, stop, restart, or remove containers from the workbench.                                 | Removing a running container uses force removal.                                                   |
| Open a container shell  | Start `docker exec -it` in a workspace terminal, preferring `bash` and falling back to `sh`.   | The container must be running, and the host needs the `docker` CLI.                                |
| Browse Docker resources | List images, volumes, and networks; open details; remove or prune the selected resource kind.  | The UI protects the built-in `bridge`, `host`, and `none` networks from removal.                   |
| Operate Compose groups  | Group containers by Compose project labels, then run **Up**, **Restart all**, or **Stop all**. | **Up** needs Compose v2 and may recreate or pull services; restart and stop address known members. |
| Run manifest actions    | Open a Dockerfile or Compose file and run its generated command in a workspace terminal.       | Dockerfile builds and Compose **Up**, **Down**, **Ps**, **Logs**, and **Build** require the CLI.   |
| Attach runtime context  | Add `localix://resource/docker` references for containers, images, volumes, or networks.       | Expansion is read-only and returns the selected resource or container detail.                      |

### Agent access

The workbench contributes no Docker agent tool. The read verbs of the CLI are already available
through `bash`, and a wrapper would pay roughly 220 tokens of schema on every request to repeat
them.

Docker still reaches the agent as context rather than as a tool — `localix://resource/docker`
references expand into read-only snapshots you can attach to a message.

## How it works

At API startup, the plugin resolves the Docker endpoint and negotiates a direct Engine API client.
The direct client handles inventory, logs, stats, lifecycle actions, removal, and prune through API
versions 1.40 through 1.44.

If the endpoint needs SSH or TLS handling, falls outside that API range, or cannot be reached
directly, Localix selects the Docker CLI backend. Compose remains a CLI operation on either path.
Interactive container shells and Dockerfile or Compose run bars also open visible CLI commands in a
workspace terminal.

Docker resource references resolve through the same read methods as the workbench. A container can
expand to a summary, log tail, stats snapshot, or process table; image, volume, and network
references expand to identity and metadata.

## Configuration

Docker endpoint resolution follows this order:

| Priority | Input                                                         | Result                                                                                           |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1        | `DOCKER_HOST`                                                 | Uses the explicit endpoint.                                                                      |
| 2        | `DOCKER_CONTEXT`, otherwise `currentContext` in Docker config | Reads that context from `DOCKER_CONFIG` or the default Docker configuration directory.           |
| 3        | Platform default                                              | Uses `/var/run/docker.sock` on Unix-like systems or `npipe:////./pipe/docker_engine` on Windows. |

| Endpoint or action                                      | Backend                | Additional requirement                               |
| ------------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| Unix socket, Windows named pipe, plain TCP, or HTTP     | Engine API when usable | Docker API negotiation must succeed.                 |
| `ssh://`, HTTPS/TLS, unsupported, or failed negotiation | Docker CLI             | `docker` must be on the API process's `PATH`.        |
| Compose project **Up**                                  | Docker CLI             | Compose v2 and project location labels are required. |
| Dockerfile, Compose run bar, or interactive exec        | Workspace terminal     | The local `docker` CLI must be available.            |

## Limits

- The provider does not install or start Docker. A missing daemon leaves the Containers area
  unavailable while other DevOps providers can continue operating.
- Native Engine API transport does not implement SSH tunneling or client-certificate TLS. Those
  endpoints use the Docker CLI fallback.
- Compose project discovery depends on `com.docker.compose.project` labels. **Up** also needs the
  stored working-directory or config-file labels used to locate the Compose manifest.
- The workbench can mutate Docker state. Docker resource references are read-only.
- Docker execution environments for agent sessions are a separate, currently unreachable surface.
  See [Execution environments](execution-environments.md).

## Related guides

- [DevOps Workspace](devops.md)
- [Kubernetes](kubernetes.md)
- [Execution environments](execution-environments.md)
- [Plugins](../extending/plugins.md)

## Source of truth

- [Backend selection](https://github.com/rsaryev/localix/blob/main/plugins/devops/docker/backend/backend-selection.ts)
- [Endpoint resolution](https://github.com/rsaryev/localix/blob/main/plugins/devops/docker/backend/docker-host.ts)
- [Engine API client](https://github.com/rsaryev/localix/blob/main/plugins/devops/docker/backend/api-backend.ts)
- [Engine API version negotiation](https://github.com/rsaryev/localix/blob/main/plugins/devops/docker/backend/api-version.ts)
- [Docker CLI backend](https://github.com/rsaryev/localix/blob/main/plugins/devops/docker/backend/backend.ts)
- [UI contributions](https://github.com/rsaryev/localix/blob/main/plugins/devops/docker/ui/register.tsx)

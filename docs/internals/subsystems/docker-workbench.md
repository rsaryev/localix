# Docker provider internals

The Docker provider supplies container operations inside the bundled DevOps Workspace plugin. Use
this page when changing endpoint selection, backend contracts, routes, polling, actions, or Docker
UI contributions.

## Terminology

| Term               | Meaning                                                           | Boundary                                                               |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Docker provider    | The Docker backend and UI slices under the `devops` plugin.       | It has no independent manifest, package, enable switch, or launcher.   |
| Engine backend     | The `ContainerEngineBackend` port used by the service and routes. | Callers do not know whether the Engine API or CLI implements it.       |
| Engine API backend | Structured HTTP access through a negotiated Docker API version.   | SSH and client-certificate TLS endpoints are not implemented natively. |
| CLI backend        | A bounded `docker` process adapter implementing the same port.    | The executable must be on the API host's `PATH`.                       |
| Resource work item | A transient container, image, volume, or network detail tab.      | Live daemon objects are not restored after restart.                    |
| Manifest editor    | A Dockerfile or Compose file editor with terminal run actions.    | It launches visible CLI commands and does not use the Engine API.      |

## What you can do

| Operation                 | Mechanism                                                                    | Boundary                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Read inventory            | Separate routes list containers, images, volumes, and networks.              | A collection failure does not erase last-good rows from other collections.       |
| Inspect a container       | Detail tabs load logs, stats, and process rows from the shared backend port. | Stats and process data can be absent for stopped or unsupported containers.      |
| Change container state    | Routes start, stop, restart, or remove a selected container.                 | UI state reports action failures inline; agent-driven changes go through `bash`. |
| Remove or prune resources | Routes remove images, volumes, and networks or prune a resource kind.        | The UI presents confirmation before destructive actions.                         |
| Operate Compose groups    | Labels group containers and the CLI can run project **Up**.                  | Compose v2 and manifest-location labels are required for **Up**.                 |
| Open an interactive shell | The UI starts `docker exec -it` in the existing workspace terminal.          | This path always requires the Docker CLI and a running container.                |
| Attach Docker context     | Resource and context providers expand `localix://resource/docker` URIs.      | Expansion uses read methods only.                                                |

## How it works

### Backend selection

`register` calls `selectDockerBackend` before constructing the service. Selection resolves the
daemon endpoint, probes unversioned `/version`, and negotiates API version 1.40 through 1.44.

Unix sockets, Windows named pipes, and plain HTTP endpoints use the Engine API when negotiation
succeeds. SSH, HTTPS, unsupported schemes or versions, and unreachable direct endpoints select the
complete CLI backend instead.

The Engine API implements inventory, logs, stats, lifecycle actions, removal, and prune with
structured requests. Compose remains a CLI exception because it is a client-side command rather than
an Engine endpoint.

### Service and routes

`DockerService` is the backend port plus a process-lifetime memoization of the Compose availability
probe. It stores no connection record because the daemon is host-wide.

Routes mount at `/rpc/docker`. Every service failure is mapped to a typed Docker code:
`engine_unavailable`, `not_found`, `action_failed`, or `engine_error`. A missing engine maps to 503,
a missing object to 404, and other action or engine failures to 400.

The workbench contributes **no agent tool**: a wrapper around the read verbs of a CLI the agent
already runs through `bash` would pay roughly 220 tokens of schema on every request. The panel,
routes, and the resource/search/context providers are unaffected.

### UI state and refresh

The UI contribution registers transient `docker-container` and `docker-resource` work items, lazy
search, resource anchors, and Dockerfile or Compose file handling. Broad Docker anchors route into
the singleton DevOps Workspace; entity anchors open detail tabs.

While a Docker surface is visible, the backend runs one `docker events` child for every follower
(`events-stream.ts`) and pushes each inventory change as a `k`-tagged realtime frame
(`events-contract.ts`). `useDocker` re-reads containers on a container event and everything on an
image, volume, or network event, coalescing a burst into one read; health-check execs are not
streamed. While the stream is live the poll is a 30-second full-read backstop. While it is down — no
`docker` CLI, a stopped daemon, a dropped socket — `useDocker` polls containers every four seconds
and images, volumes, and networks every 20, shortened to eight while a secondary collection is
recovering. A full refresh uses independent settled requests and keeps successful or cached
collections visible.

A container tab re-reads on its own container's events. Its three-second tick stays for what is
sampled rather than announced — the log tail, stats, and processes of a running container — and is
dropped while the stream is live for a stopped container or a paused log view.

### Module invariants

| Owner            | Invariant                                                                | Failure when violated                                                             |
| ---------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Backend port     | API and CLI adapters implement the same normalized contract.             | Routes or UI branch on transport-specific data.                                   |
| Backend selector | Unsupported native transports fall back as a complete unit.              | One operation silently uses credentials or endpoint rules different from another. |
| Routes           | Validation and backend failures use one typed error shape.               | Empty states and inline action errors lose their stable classification.           |
| Refresh model    | Collection failures preserve the previous successful snapshot.           | A partial daemon failure appears as data deletion.                                |
| UI actions       | Destructive resource operations pass through confirmation state.         | A click immediately removes shared daemon state.                                  |
| Terminal actions | Interactive exec and manifest commands reuse the workspace terminal bus. | The provider creates a competing PTY lifecycle.                                   |

## Configuration

### Endpoint resolution

| Priority | Input                   | Result                                                           | Boundary                                                      |
| -------- | ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| 1        | `DOCKER_HOST`           | Parses the explicit socket, pipe, SSH, or network endpoint.      | Wins over every context setting.                              |
| 2        | `DOCKER_CONTEXT`        | Reads that context from Docker's configuration directory.        | Used only when `DOCKER_HOST` is unset.                        |
| 3        | Docker `currentContext` | Reads the selected context from Docker configuration.            | The `default` context falls through to the platform endpoint. |
| 4        | Platform default        | Uses `/var/run/docker.sock` or the Windows `docker_engine` pipe. | An unavailable endpoint still falls back to the CLI backend.  |

`DOCKER_CONFIG` overrides the Docker configuration directory. Context metadata is resolved by the
SHA-256 directory name used by the Docker context store.

### Transport and time bounds

| Path                       | Bound                  | Failure behavior                                            |
| -------------------------- | ---------------------- | ----------------------------------------------------------- |
| Engine API request         | 10 seconds             | Maps transport failure through the Docker error vocabulary. |
| Engine API stats           | 15 seconds             | Returns `null` for a stopped-container conflict.            |
| Engine API stop or restart | 30 seconds             | Surfaces a typed action or engine failure.                  |
| CLI command                | 10 seconds             | Terminates the process and maps the failure.                |
| Logs route                 | 1–5,000 trailing lines | Rejects values outside the schema.                          |

## Limits

- The provider does not install or start a daemon. When neither direct access nor a working CLI can
  reach Docker, the Containers area reports the engine unavailable.
- Native transport does not implement SSH tunnels or client-certificate TLS. The CLI fallback owns
  those connection modes.
- Compose **Up**, interactive exec, and manifest run bars require the Docker CLI even when inventory
  uses the Engine API.
- Compose project location comes from container labels. **Up** fails when neither a working
  directory nor config-file list can be recovered.
- The backend is host-wide and has no per-user connection registry. Route authentication still
  applies, but all users of one API process address the same selected daemon.
- Docker agent execution environments are a separate dormant adapter surface; this workbench does
  not select a session execution environment.

## Related guides

- [DevOps Workspace internals](devops-workbench.md)
- [Kubernetes provider internals](kubernetes-workbench.md)
- [Containers](../../features/docker.md)
- [DevOps Workspace](../../features/devops.md)
- [Execution environments](../../features/execution-environments.md)

## Source of truth

- [Provider registration](../../../mini-apps/devops/docker/backend/index.ts)
- [Backend port and CLI adapter](../../../mini-apps/devops/docker/backend/backend.ts)
- [Backend selection](../../../mini-apps/devops/docker/backend/backend-selection.ts)
- [Endpoint resolution](../../../mini-apps/devops/docker/backend/docker-host.ts)
- [API transport](../../../mini-apps/devops/docker/backend/api-transport.ts)
- [Engine API adapter](../../../mini-apps/devops/docker/backend/api-backend.ts)
- [Routes](../../../mini-apps/devops/docker/backend/routes.ts)
- [UI registration](../../../mini-apps/devops/docker/ui/register.tsx)
- [Inventory model](../../../mini-apps/devops/docker/ui/model/useDocker.ts)

# DevOps Workspace internals

DevOps Workspace composes Docker and Kubernetes providers behind one bundled mini app and one global
tab. Use this page when changing provider composition, shared navigation, lifecycle ownership, or
persisted presentation state.

## Terminology

| Term               | Meaning                                                                                             | Boundary                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| DevOps mini app    | The default-enabled `devops` manifest and its backend and UI entrypoints.                           | Docker and Kubernetes have no independent enable switch.           |
| Provider           | A transport-specific Docker or Kubernetes backend and UI contribution set.                          | Providers keep separate routes, state, errors, and shutdown needs. |
| Backend subsystem  | A registered route plus optional resource, context, search, live-frame, and shutdown contributions. | Its id is a host registry key, not the installable mini app id.    |
| DevOps work item   | The restorable, global `devops` tab with Overview, Containers, and Kubernetes areas.                | Entity detail tabs are transient.                                  |
| Resource reference | A `localix://resource/docker` or `localix://resource/k8s` URI expanded by its provider.             | Expansion adds bounded read context and performs no mutation.      |
| Provider model     | The state returned by `useDocker` or `useKubernetes` and retained by the root shell.                | Live requests pause while the work item is hidden.                 |

## What you can do

| Surface                       | Mechanism                                                                                              | Boundary                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Open one operations workspace | The mini app contributes one overflow launcher and one global `devops` work item.                      | The root manifest enables or disables both providers together.                                 |
| Compare provider state        | Overview derives container, image, project, pod, deployment, node, and issue summaries.                | A failed collection shows an issue instead of treating stale data as current health.           |
| Inspect containers            | Docker contributes inventory, details, logs, stats, processes, search, and resource references.        | Daemon access and some actions require the Docker CLI.                                         |
| Inspect clusters              | Kubernetes contributes workloads, pods, deployments, services, nodes, metrics, search, and references. | Kubeconfig credentials, network access, and RBAC control results.                              |
| Drive engines from an agent   | Neither backend contributes an agent tool; the agent runs `docker` and `kubectl` through `bash`.       | CLI calls use the agent's permission rules; cluster access also requires credentials and RBAC. |
| Navigate from resources       | Provider anchors open entity tabs or route broad URIs into the matching DevOps area.                   | Detail work items are not restored after an application restart.                               |

## How it works

### Mini app composition

The root backend entrypoint registers both providers concurrently, then concatenates their backend
and tool contributions. Docker retains subsystem id `devops:docker` and route `/rpc/docker`;
Kubernetes retains subsystem id `devops:kubernetes` and route `/rpc/kubernetes`.

Separate subsystem ids preserve provider-owned resource, context, search, WebSocket, and shutdown
registrations. The single manifest supplies the installation identity and enable boundary.

The root UI entrypoint first registers both provider contribution sets. It then contributes one
global, restorable DevOps work item and an overflow rail viewlet whose mount owns Kubernetes
port-forward cleanup for closed owner tabs.

The mini app's UI artifact compiles its utility CSS from every `ui/` or `shared/` source folder,
including provider folders such as `docker/ui/` and `kubernetes/ui/`. The provider components bundle
as JavaScript independently of that scan; omitting their CSS leaves resource tabs and inventory rows
without their grid geometry.

### Workspace state

`DevOpsWorkspace` mounts `useDocker` and `useKubernetes` above the area switch. Moving among
Overview, Containers, and Kubernetes therefore preserves snapshots, selection, polling, and watch
state while the root tab remains mounted.

The editor grid can keep recent work items mounted while hidden. `useElementVisible` combines actual
visibility with the work-item `active` flag; provider hooks stop steady requests when either is
false.

Overview reads both provider models without merging their authority. Docker collection failures and
Kubernetes collection failures remain provider-specific and last-good rows remain available when a
partial refresh succeeds.

### Provider ownership

Docker resolves an Engine API transport and retains the CLI as a compatibility path. The provider
owns no long-running backend handles, so its shutdown hook is empty.

Kubernetes uses its API backend for reads, mutations, discovery, watches, exec, and port forwarding.
Its shutdown hook closes exec bridges, port forwards, and watches in that order. Detailed provider
contracts live in [Docker provider internals](docker-workbench.md) and
[Kubernetes provider internals](kubernetes-workbench.md).

### Module invariants

| Owner              | Invariant                                                                       | Failure when violated                                                         |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Root manifest      | One mini app name and one enable state cover both providers.                    | Settings can expose a provider whose compiled root cannot load independently. |
| Root backend       | Provider subsystem ids and RPC mounts remain distinct.                          | Resources, routes, live frames, or shutdown hooks collide.                    |
| Root UI            | Provider models mount above the area switch.                                    | Changing areas discards inventory, selection, timers, and watches.            |
| UI artifact        | Utility scanning includes nested provider UI folders.                           | Bundled provider rows render without their layout rules.                      |
| Provider UI        | Broad anchors route to the singleton `devops` work item.                        | Navigation creates competing workspace roots with divergent state.            |
| Provider state     | Partial failures preserve last-good collections and mark the failed collection. | Stale data is presented as an authoritative empty result.                     |
| Kubernetes backend | Stateful exec, watch, and forward registries close on shutdown.                 | Loopback listeners or cluster streams outlive their owner.                    |

## Configuration

### Provider inputs

| Input                     | Effect                                                                         | Boundary                                                    |
| ------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Mini app enabled state    | Registers both backend subsystems, both resource providers, and the DevOps UI. | Docker and Kubernetes cannot be toggled separately.         |
| `DOCKER_HOST`             | Selects an explicit Docker endpoint.                                           | It overrides Docker context and the platform default.       |
| Docker context and config | Supplies a context endpoint when `DOCKER_HOST` is unset.                       | Some endpoint types select the CLI fallback.                |
| `KUBECONFIG`              | Supplies kubeconfig files to the Kubernetes client.                            | Unset uses the client's platform default.                   |
| Kubeconfig context        | Selects cluster, user, and namespace defaults per request.                     | UI selection does not rewrite kubeconfig's current context. |

### Persisted UI records

| Key                              | Owner          | Stored state                                             | Invalid-data behavior                             |
| -------------------------------- | -------------- | -------------------------------------------------------- | ------------------------------------------------- |
| `localix.devops.area`            | Root workspace | Overview, Containers, or Kubernetes.                     | Falls back to Overview.                           |
| `localix.devops.containers.view` | Docker UI      | Resource kind, filter, and per-kind sort.                | Normalizes to Containers and supported sort keys. |
| `localix.k8s.view`               | Kubernetes UI  | Resource kind, filter, and per-kind sort.                | Migrates older shapes to Workloads.               |
| `localix.k8s.selection`          | Kubernetes UI  | Active context and one remembered namespace per context. | Fresh cluster lists validate stored names.        |

## Limits

- Disabling `devops` removes both providers and all three tools. Provider directories contain no
  standalone manifest, package, or UI launcher.
- Docker and Kubernetes can fail independently after registration, but their root mini app
  entrypoint is shared. A root registration failure prevents the combined backend contribution from
  loading.
- The DevOps work item is restorable; Docker container/resource and Kubernetes pod/resource work
  items are intentionally transient because their backing objects can disappear.
- Kubernetes watches, exec relays, and port forwards are process-memory lifecycles. They are closed,
  not restored, on shutdown.
- A bash dangerous-pattern confirmation is an application safety gate. Cluster credentials and RBAC
  remain the enforcement boundary for the API call.
- Provider resource references are read operations. Adding one to a message does not authorize a
  lifecycle or cluster mutation.

## Related guides

- [DevOps Workspace](../../features/devops.md)
- [Containers](../../features/docker.md)
- [Kubernetes](../../features/kubernetes.md)
- [Mini apps](../../extending/mini-apps.md)
- [Execution environments](../../features/execution-environments.md)

## Source of truth

- [Mini app manifest](../../../mini-apps/devops/mini-app.json)
- [Backend composition](../../../mini-apps/devops/backend/index.ts)
- [UI composition](../../../mini-apps/devops/ui/register.tsx)
- [Root workspace](../../../mini-apps/devops/ui/DevOpsWorkspace.tsx)
- [Overview derivation](../../../mini-apps/devops/ui/model/devopsOverview.ts)
- [Docker backend registration](../../../mini-apps/devops/docker/backend/index.ts)
- [Kubernetes backend registration](../../../mini-apps/devops/kubernetes/backend/index.ts)
- [Docker UI registration](../../../mini-apps/devops/docker/ui/register.tsx)
- [Kubernetes UI registration](../../../mini-apps/devops/kubernetes/ui/register.tsx)

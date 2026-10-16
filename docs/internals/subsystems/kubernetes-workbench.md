# Kubernetes provider internals

Kubernetes is the API-native cluster provider inside the bundled DevOps Workspace plugin. Use this
reference when changing kubeconfig handling, cluster operations, live transports, tools, or UI
contributions.

## Terminology

| Term               | Meaning                                                                   | Boundary                                                        |
| ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Provider           | The `kubernetes` backend subsystem contributed by plugin `devops`         | It has no independent manifest or enable switch                 |
| Context            | A kubeconfig context selected on an in-memory `KubeConfig` per request    | Selection does not rewrite kubeconfig `current-context`         |
| API backend        | Injectable `KubernetesBackend` implementation over Kubernetes API clients | Routes and UI depend only on Localix contracts                  |
| Pod informer       | Reference-counted list/watch entry keyed by context and namespace         | REST polling remains the reconciliation fallback                |
| Managed forward    | In-memory loopback TCP listener bridged to a pod port-forward subresource | It survives only for the Localix process                        |
| Resource reference | A `localix://resource/k8s` URI expanded by the provider                   | Expansion is read-only and does not include kubeconfig contents |

## What you can do

| Operation                 | Mechanism                                                                           | Boundary                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Inspect cluster resources | List contexts, namespaces, pods, deployments, services, nodes, and discovered kinds | Dedicated UI views cover pods, deployments, services, and nodes            |
| Follow pod state          | Share one `ListWatch` informer among subscribers for a context and namespace        | A failed watch reports `down` while REST refresh remains authoritative     |
| Read diagnostics          | Fetch logs, events, describe output, manifests, and optional metrics                | RBAC and `metrics.k8s.io` determine availability                           |
| Run pod commands          | Mint a one-use loopback WebSocket relay into the Kubernetes exec subresource        | The token expires after 30 seconds and is consumed on connection           |
| Forward a pod port        | Bind `127.0.0.1` and bridge TCP connections through the port-forward subresource    | Forward state and sockets are process-local                                |
| Change cluster state      | Patch, evict, delete, or server-side-apply through typed service methods            | UI actions are explicit; agent-driven changes go through `kubectl` in bash |
| Add cluster context       | Expand Kubernetes resource URIs into persisted Context Fabric snapshots             | The provider exports resource content, never credentials                   |

User workflows and prerequisites belong to
[Operate Kubernetes clusters](../../features/kubernetes.md). Plugin composition belongs to
[DevOps Workspace internals](devops-workbench.md).

## How it works

```text
DevOps Workspace and Kubernetes detail tabs
  -> /rpc/kubernetes and k8s.watch WebSocket commands
  -> KubernetesService
  -> pod informer, exec, and port-forward registries
  -> injectable KubernetesBackend
  -> @kubernetes/client-node typed and object APIs
  -> Bun HTTP and WebSocket transports with kubeconfig auth and TLS
```

### Module contracts

| Module                                                                                  | Mechanism and invariant                                                                                | Failure when violated                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`backend/index.ts`](../../../plugins/devops/kubernetes/backend/index.ts)               | Returns one backend subsystem, resource/context/search providers, pod-watch frames, and shutdown hooks | Plugin disable leaves live sockets or a contribution without its owning service |
| [`backend-port.ts`](../../../plugins/devops/kubernetes/backend/backend-port.ts)         | Keeps routes and UI on cluster-neutral Localix shapes                                                  | Generated client models leak across the subsystem boundary                      |
| [`api-backend.ts`](../../../plugins/devops/kubernetes/backend/api-backend.ts)           | Selects context per config, maps API objects, and implements reads and mutations                       | A call can target the wrong cluster or return transport-specific data           |
| [`api-http.ts`](../../../plugins/devops/kubernetes/backend/api-http.ts)                 | Applies kubeconfig authentication, CA, client certificate/key, server name, and HTTP proxy             | API requests fail or bypass configured trust material                           |
| [`api-websocket.ts`](../../../plugins/devops/kubernetes/backend/api-websocket.ts)       | Applies kubeconfig TLS and headers to watch, exec, and forwarding sockets                              | Streaming paths use different trust or authentication from REST                 |
| [`api-watch.ts`](../../../plugins/devops/kubernetes/backend/api-watch.ts)               | Reference-counts informers and reconnects with capped exponential backoff                              | Dead watches are reported as live or leak after the last subscriber             |
| [`api-exec.ts`](../../../plugins/devops/kubernetes/backend/api-exec.ts)                 | Keeps credentials out of terminal commands by using a one-use local relay token                        | Reusable relay URLs widen access to a pod shell                                 |
| [`api-port-forward.ts`](../../../plugins/devops/kubernetes/backend/api-port-forward.ts) | Validates the pod, binds loopback, probes the real tunnel, and tracks owner generation                 | A listening socket is reported ready without a working cluster tunnel           |
| [`route-guard.ts`](../../../plugins/devops/kubernetes/backend/route-guard.ts)           | Maps validation and Kubernetes failures into one typed error envelope                                  | UI receives raw errors or inconsistent HTTP status codes                        |
| [`ui/register.tsx`](../../../plugins/devops/kubernetes/ui/register.tsx)                 | Registers transient entity tabs, search scope, glyphs, and URI anchors                                 | Restored tabs can query deleted live objects or search hits cannot open         |

### Mutation contracts

| Mutation                | API mechanism                                                    | Failure boundary                                                     |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Restart deployment      | Strategic-merge patch of the pod-template restart annotation     | The rollout is asynchronous after the patch succeeds                 |
| Scale deployment        | Merge patch of `spec.replicas`                                   | Replica count accepts 0 through 1,000 in the route schema            |
| Delete pod              | `deleteNamespacedPod`                                            | A controller may recreate a managed pod                              |
| Cordon or uncordon node | Merge patch of `spec.unschedulable`                              | Existing pods remain on cordon                                       |
| Drain node              | Cordon, then repeated `policy/v1` evictions                      | Stops after 120 seconds; skips completed, mirror, and DaemonSet pods |
| Apply manifest          | Strip server-owned fields, dry-run `All`, then server-side apply | No rollback is implemented after a successful apply                  |

The workbench contributes **no agent tools**: wrapper schemas would cost roughly 930 tokens on every
request to repeat verbs of a CLI the agent already drives through `bash`. `kubectl delete` and
`kubectl drain` match bash's dangerous-command patterns; the agent's permission rules decide whether
to allow, confirm, or deny them. The panel, routes, resource/search/context providers, and the live
pod watch are unaffected.

### Contribution and lifecycle

The backend subsystem mounts `/rpc/kubernetes`, owns `localix://resource/k8s`, contributes lazy
global search, and exposes `devops:k8s.watch.subscribe` / `devops:k8s.watch.unsubscribe` with frame
tag `w`. Shutdown stops every exec bridge, forward, and informer.

The root DevOps UI registers the restorable `devops` work item and overflow launcher. Kubernetes
registers non-restorable `kubernetes-pod` and `kubernetes-resource` entity tabs. Broad resource
anchors open the DevOps singleton; entity anchors open the matching transient tab.

## Configuration

| Control              | Current value                  | Effect                                                      |
| -------------------- | ------------------------------ | ----------------------------------------------------------- |
| Plugin manifest      | `devops`, enabled by default   | One switch controls Docker and Kubernetes providers         |
| Backend route        | `/rpc/kubernetes`              | Mounts the typed REST surface                               |
| Kubeconfig load      | `KubeConfig.loadFromDefault()` | Uses the client library's default kubeconfig discovery      |
| Context config cache | `60_000` ms                    | Reuses validated in-memory configs by selected context      |
| Generic list limit   | `200` rows by default          | Requests one extra row to set `truncated` accurately        |
| Lazy search fan-out  | First `12` namespaces          | Searches pod names only when the `k8s` scope is selected    |
| Watch idle TTL       | `5000` ms                      | Stops an informer after its final subscriber leaves         |
| Watch restart delay  | `1500` to `30_000` ms          | Backs off while subscribers remain                          |
| Exec token lifetime  | `30_000` ms                    | Expires an unused single-use local relay                    |
| Port-forward host    | `127.0.0.1`                    | Prevents managed listeners from binding external interfaces |

## Limits

- The provider does not install Kubernetes, create clusters, or issue credentials. Kubeconfig,
  network reachability, credential helpers, and RBAC remain host responsibilities.
- It does not invoke `kubectl`. A kubeconfig `exec` authentication entry can still launch its named
  credential helper on the Localix host.
- HTTP honors kubeconfig `proxyUrl`. The custom WebSocket constructor does not pass that proxy, so
  watches, exec, and port forwards can fail for proxy-only clusters.
- Pod and node metrics resolve to unavailable when `metrics.k8s.io` is missing, unreachable, or
  forbidden; core inventories continue.
- Generic API discovery can list installed custom resources. The workbench has no generic detail
  editor for them.
- Search inspects pod names in the current or first context across at most 12 namespaces. It does
  not search deployments, services, nodes, manifests, or logs.
- Pod, deployment, service, and node detail tabs are not restored across application restart.
- Managed forwards and exec bridges are in memory and are closed on plugin shutdown.

## Related guides

- [DevOps Workspace internals](devops-workbench.md)
- [Kubernetes](../../features/kubernetes.md)
- [DevOps Workspace](../../features/devops.md)
- [Workbench contributions](workbench-contributions.md)

## Source of truth

- [Plugin boundary](../../../plugins/devops/plugin.json) ·
  [plugins/devops/backend/index.ts](../../../plugins/devops/backend/index.ts)
- [Backend composition](../../../plugins/devops/kubernetes/backend/index.ts) ·
  [routes.test.ts](../../../plugins/devops/kubernetes/backend/routes.test.ts)
- [Kubernetes API behavior](../../../plugins/devops/kubernetes/backend/api-backend.ts) ·
  [kubernetes-client.test.ts](../../../plugins/devops/kubernetes/backend/kubernetes-client.test.ts)
- [Watch, exec, and forward lifecycle](../../../plugins/devops/kubernetes/backend/api-watch.test.ts)
  · [api-exec.test.ts](../../../plugins/devops/kubernetes/backend/api-exec.test.ts) ·
  [api-port-forward.test.ts](../../../plugins/devops/kubernetes/backend/api-port-forward.test.ts)
- [API discovery](../../../plugins/devops/kubernetes/backend/discovery.ts)
- [Resource and context references](../../../plugins/devops/kubernetes/backend/resource-provider.ts)
  · [context-provider.ts](../../../plugins/devops/kubernetes/backend/context-provider.ts)
- [UI contributions](../../../plugins/devops/kubernetes/ui/register.tsx) ·
  [ui/register.test.tsx](../../../plugins/devops/kubernetes/ui/register.test.tsx)

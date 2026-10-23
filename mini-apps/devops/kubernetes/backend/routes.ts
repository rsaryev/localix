import { Hono } from 'hono'
import { summarizeZodIssues } from '@localixai/mini-app-sdk/backend'
import type { MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import {
  applyManifestSchema,
  contextQuerySchema,
  genericListQuerySchema,
  kubeManifestKindSchema,
  kubeResourceKindSchema,
  namespaceQuerySchema,
  podLogsQuerySchema,
  podExecSchema,
  scaleDeploymentSchema,
  startPortForwardSchema,
  stopForwardsByOwnerSchema,
} from './contracts'
import { z } from 'zod'
import type { KubernetesService } from './service'
// The typed error body + status funnel every route goes through lives in
// `route-guard.ts` so the mapping can never drift between endpoints.
import { guarded, kubeErrorBody, OK, statusFor, validated } from './route-guard'
import { KubeError } from './errors'
import type { KubeErrorResponse } from './contracts'

/**
 * Kubernetes workbench backend — a surface over the Kubernetes API: contexts /
 * namespaces / pods / deployments / services / nodes, pod logs / describe / events /
 * delete, deployment restart + scale, node cordon/uncordon/drain, live-manifest
 * get + dry-run-validated apply, and managed port-forwards. The kubeconfig on disk is
 * the source of truth and the active context is chosen per-request via `?context=`
 * without mutating the global kubeconfig, so there is no per-user connection registry
 * (unlike the database workbench). A missing kubeconfig or unreachable cluster surfaces as a typed 503 the sidebar
 * renders as a quiet empty state rather than an error toast.
 */
export function createKubernetesRoutes(service: KubernetesService) {
  const app = new Hono<MiniAppRouteContext>()

  const routes = app
    .get('/contexts', (c) => guarded(c, () => service.listContexts()))
    .get('/namespaces', validated('query', contextQuerySchema), (c) =>
      guarded(c, async () => ({
        namespaces: await service.listNamespaces(c.req.valid('query').context),
      })),
    )
    .get('/pods', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace } = c.req.valid('query')
        return { pods: await service.listPods(namespace ?? '', context) }
      }),
    )
    .get('/deployments', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace } = c.req.valid('query')
        return { deployments: await service.listDeployments(namespace ?? '', context) }
      }),
    )
    .get('/services', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace } = c.req.valid('query')
        return { services: await service.listServices(namespace ?? '', context) }
      }),
    )
    // Discovery + one parameterized list, instead of a route per kind. Same reasoning as the port:
    // the object API was always generic, so only kind RESOLUTION was missing.
    .get('/api-resources', validated('query', contextQuerySchema), (c) =>
      guarded(c, () => service.listApiResources(c.req.valid('query').context)),
    )
    .get('/objects', validated('query', genericListQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace, kind, limit } = c.req.valid('query')
        const list = await service.listByKind(kind, namespace ?? '', { context, limit })
        // An unknown kind is a missing resource, so it funnels through the SAME typed 404 as a
        // missing pod rather than inventing a second not-found shape for the client to learn.
        if (!list) throw new KubeError('not_found', `No listable resource kind matching "${kind}"`)
        return list
      }),
    )
    .get('/nodes', validated('query', contextQuerySchema), (c) =>
      guarded(c, async () => ({ nodes: await service.listNodes(c.req.valid('query').context) })),
    )
    // Usage is a SEPARATE endpoint, not a field on the pod/node rows: `metrics.k8s.io` is
    // a different API server that may be absent, slow or forbidden, and folding it into
    // the list would couple a working resource list to an optional add-on's latency.
    .get('/metrics/pods', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace } = c.req.valid('query')
        return { pods: await service.podMetrics(namespace ?? '', context) }
      }),
    )
    .get('/metrics/nodes', validated('query', contextQuerySchema), (c) =>
      guarded(c, async () => ({ nodes: await service.nodeMetrics(c.req.valid('query').context) })),
    )
    .post('/nodes/:name/cordon', validated('query', contextQuerySchema), (c) =>
      guarded(c, async () => {
        await service.cordonNode(c.req.param('name'), c.req.valid('query').context)
        return OK
      }),
    )
    .post('/nodes/:name/uncordon', validated('query', contextQuerySchema), (c) =>
      guarded(c, async () => {
        await service.uncordonNode(c.req.param('name'), c.req.valid('query').context)
        return OK
      }),
    )
    .post('/nodes/:name/drain', validated('query', contextQuerySchema), (c) =>
      guarded(c, async () => {
        await service.drainNode(c.req.param('name'), c.req.valid('query').context)
        return OK
      }),
    )
    .get('/deployments/:name/pods', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace } = c.req.valid('query')
        return {
          pods: await service.listDeploymentPods(namespace ?? '', c.req.param('name'), context),
        }
      }),
    )
    .get('/pods/:name/logs', validated('query', podLogsQuerySchema), (c) =>
      guarded(c, () => {
        const { context, namespace, container, tail, sinceSeconds, previous, allContainers } =
          c.req.valid('query')
        return service.podLogs(namespace ?? '', c.req.param('name'), {
          container,
          tail: tail ?? 500,
          context,
          previous,
          sinceSeconds,
          allContainers,
        })
      }),
    )
    .get('/pods/:name/describe', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, () => {
        const { context, namespace } = c.req.valid('query')
        return service.describePod(namespace ?? '', c.req.param('name'), context)
      }),
    )
    .post(
      '/pods/:name/exec',
      validated('query', namespaceQuerySchema),
      validated('json', podExecSchema),
      (c) =>
        guarded(c, async () => {
          const { context, namespace } = c.req.valid('query')
          const { container } = c.req.valid('json')
          return {
            command: await service.startPodExec(
              namespace ?? '',
              c.req.param('name'),
              context,
              container,
            ),
          }
        }),
    )
    .post('/pods/:name/delete', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace } = c.req.valid('query')
        await service.deletePod(namespace ?? '', c.req.param('name'), context)
        return OK
      }),
    )
    .get('/pods/:name/events', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace } = c.req.valid('query')
        return { events: await service.podEvents(namespace ?? '', c.req.param('name'), context) }
      }),
    )
    .post('/deployments/:name/restart', validated('query', namespaceQuerySchema), (c) =>
      guarded(c, async () => {
        const { context, namespace } = c.req.valid('query')
        await service.restartDeployment(namespace ?? '', c.req.param('name'), context)
        return OK
      }),
    )
    .post(
      '/deployments/:name/scale',
      validated('query', namespaceQuerySchema),
      validated('json', scaleDeploymentSchema),
      (c) =>
        guarded(c, async () => {
          const { context, namespace } = c.req.valid('query')
          await service.scaleDeployment(
            namespace ?? '',
            c.req.param('name'),
            c.req.valid('json').replicas,
            context,
          )
          return OK
        }),
    )
    .get(
      '/resources/:kind/:name/describe',
      validated('param', z.object({ kind: kubeResourceKindSchema, name: z.string().min(1) })),
      validated('query', namespaceQuerySchema),
      (c) =>
        guarded(c, async () => {
          const { kind, name } = c.req.valid('param')
          const { context, namespace } = c.req.valid('query')
          return { describe: await service.describeResource(kind, namespace ?? '', name, context) }
        }),
    )
    .get(
      '/resources/:kind/:name/events',
      validated('param', z.object({ kind: kubeResourceKindSchema, name: z.string().min(1) })),
      validated('query', namespaceQuerySchema),
      (c) =>
        guarded(c, async () => {
          const { kind, name } = c.req.valid('param')
          const { context, namespace } = c.req.valid('query')
          return { events: await service.resourceEvents(kind, namespace ?? '', name, context) }
        }),
    )
    .get(
      '/manifest/:kind/:name',
      validated('param', z.object({ kind: kubeManifestKindSchema, name: z.string().min(1) })),
      validated('query', namespaceQuerySchema),
      (c) =>
        guarded(c, async () => {
          const { kind, name } = c.req.valid('param')
          const { context, namespace } = c.req.valid('query')
          return { manifest: await service.getManifest(kind, name, namespace, context) }
        }),
    )
    .post(
      '/manifest/apply',
      validated('query', contextQuerySchema),
      validated('json', applyManifestSchema),
      (c) =>
        guarded(c, async () => {
          const { context } = c.req.valid('query')
          return { result: await service.applyManifest(c.req.valid('json').yaml, context) }
        }),
    )
    .get('/port-forwards', (c) => guarded(c, () => ({ portForwards: service.listPortForwards() })))
    .post('/port-forwards', validated('json', startPortForwardSchema), (c) =>
      guarded(c, async () => {
        const { context, namespace, pod, localPort, podPort, owner } = c.req.valid('json')
        const portForward = await service.startPortForward({
          namespace: namespace ?? '',
          pod,
          localPort,
          podPort,
          context,
          owner,
        })
        return { portForward }
      }),
    )
    .post('/port-forwards/stop-by-owner', validated('json', stopForwardsByOwnerSchema), (c) =>
      guarded(c, async () => ({
        ok: true as const,
        stopped: await service.stopPortForwardsByOwner(c.req.valid('json').owner),
      })),
    )
    .post('/port-forwards/:id/stop', (c) =>
      guarded(c, async () => {
        await service.stopPortForward(c.req.param('id'))
        return OK
      }),
    )

  // Fallback for a THROWN error — a `.parse()` inside a handler, or anything raised outside
  // `guarded`. It answers the SAME typed body as every route; the shared `defaultErrorHandler`
  // does not, and rethrows what it cannot classify into a bare host 500.
  routes.onError((error, c) => {
    if (error instanceof z.ZodError) {
      const summary = summarizeZodIssues(error)
      return c.json(
        {
          error: summary.headline,
          code: 'invalid_request',
          detail: summary.detail,
        } satisfies KubeErrorResponse,
        400,
      )
    }
    return c.json(kubeErrorBody(error), statusFor(error))
  })
  return routes
}

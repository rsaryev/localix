/**
 * Native mini app entrypoint — the host calls `register(ctx)` once when the (enabled) mini app
 * loads. Thin by design: it wires modules together. The tool contract lives in
 * http-request-schema.ts and the body in http-request.ts.
 *
 * `register` runs on BOTH the boot-time load (which carries `ctx.host`) and the per-run tool load
 * (which does not) — see singleton.ts for why the resolver has to outlive the call.
 *
 * The mini app contributes on two surfaces, and they are not redundant:
 *   tools   — what the MODEL can do (send a request, import a curl command).
 *   backend — what the USER can reach for: `@`-mention a saved request, find one in search, and
 *             have it captured into context before the turn starts. A tool can only answer a
 *             question the model already thought to ask.
 */

import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'
import { createApiTool } from './api-tool'
import { createRestContextProvider } from './context-provider'
import { scopedRequestPort, createRestResourceProvider } from './resource-provider'
import { createRestRoutes } from './routes'
import { createRestSearchProvider } from './search-provider'
import { bindVault, getBindSecret, getResolveSecret, getStoreSecret } from './singleton'
import { bindEnvironmentStateDir, collectionFor, environmentsFor } from './collection/for-scope'

export function register(ctx: MiniAppContext): MiniAppRegistration {
  // Only the boot load carries a host; binding here is what lets the per-run tool load reach the
  // vault — to RESOLVE a `${secret:KEY}` at send time, and to FILL one when an import arrives
  // carrying a literal.
  const host = ctx.host
  bindVault({
    resolveSecret: host
      ? (userId, key, consumer) => host.resolveSecret(userId, key, consumer).then((v) => v ?? null)
      : undefined,
    storeSecret: host ? (userId, key, value) => host.storeSecret(userId, key, value) : undefined,
    // Optional on the host: a binding registry is bookkeeping, and a leaner host omits it.
    bindSecret: host?.bindSecret
      ? (userId, key, consumer) => host.bindSecret!(userId, key, consumer)
      : undefined,
  })

  // Unscoped fallbacks are retained for hosts/tool invocations that do not carry a session id.
  // Normal workbench, context and tool calls resolve the session-owned collection below.
  const store = collectionFor(ctx.cwd)
  // The SDK's own per-mini-app directory — the mini app never constructs a `~/.localix` path.
  bindEnvironmentStateDir(ctx.stateDir)
  const environments = environmentsFor(ctx.cwd)
  const port = scopedRequestPort(async (userId, sessionId) => {
    if (!sessionId) return collectionFor(ctx.cwd)
    const cwd =
      (await host?.workspaceScope?.resolveSessionRoot(userId, sessionId).catch(() => null)) ??
      ctx.cwd
    return collectionFor(cwd, sessionId)
  })
  const resolveSecret = getResolveSecret()
  const send = {
    timeoutMs: ctx.helpers.configNumber(ctx.config.TIMEOUT_MS, 30_000),
    maxBodyBytes: ctx.helpers.configNumber(ctx.config.MAX_BODY_BYTES, 1_000_000),
    allowPrivateNetwork: ctx.helpers.configBoolean(ctx.config.ALLOW_PRIVATE_NETWORK, false),
  }

  return {
    // ONE tool. Requests and environments are two subjects, so they keep two bodies — but the
    // model sees one name, one schema and one `target` switch (see api-tool-schema.ts).
    tools: [
      createApiTool({
        ctx,
        store,
        environments,
        resolveSecret,
        storeSecret: getStoreSecret(),
        bindSecret: getBindSecret(),
        userId: ctx.userId,
        resolveScope: async (sessionId) => {
          const cwd = sessionId
            ? ((await host?.workspaceScope
                ?.resolveSessionRoot(ctx.userId, sessionId)
                .catch(() => null)) ?? ctx.cwd)
            : ctx.cwd
          return {
            store: collectionFor(cwd, sessionId),
            environments: environmentsFor(cwd, sessionId),
          }
        },
      }),
    ],
    backend: [
      {
        id: 'api:backend',
        routeMount: {
          path: '/rpc/api',
          // `storeSecret` lets a workbench IMPORT move a pasted literal into the vault, exactly as
          // the agent tool's import does; without it a UI import would leave the credential in place.
          app: createRestRoutes({
            environments,
            resolveSecret,
            storeSecret: getStoreSecret(),
            bindSecret: getBindSecret(),
            send,
          }),
        },
        resourceProvider: createRestResourceProvider(port),
        searchProvider: createRestSearchProvider(port),
        contextProviders: [createRestContextProvider(port)],
        // No onShutdown: the store holds no sockets or handles — its only resource is a file it
        // opens per write.
      },
    ],
  }
}

import { errorMessage } from '../../lib/errors'
import { importFreshModule } from '../../lib/module-url'

import type { AgentTool } from '@localixai/agent/agents'
import type {
  MemoryProvider,
  MiniAppChannel,
  MiniAppContext,
  MiniAppHooks,
  MiniAppHostServices,
} from '@localixai/mini-app-sdk/backend'

import type { DiscoveredMiniApp } from './folder'
import type { MiniAppConfigValues } from './config'
import { capMiniAppToolDescription, isAcceptableToolName } from './tool-policy'
import type { MiniAppToolDescriptor } from './contracts'
import { makeContext } from './native-context'
import {
  asBackendSubsystemArray,
  asChannelArray,
  asMemoryProvider,
  asToolArray,
  type NativeModuleExports,
} from './native-coerce'
import type { BackendSubsystem } from '../ext/subsystem-contrib'

/**
 * Native-mini-app runtime: the dynamic import of a backend entrypoint and the structural shaping of
 * what its `register(ctx)` returns into real AgentTools, hooks, channels and backend subsystems.
 * Importing a module here RUNS its top-level code, so callers only do so for enabled mini apps
 * (the trust gate lives in the loader). The context it receives is built in `native-context.ts`.
 *
 * Native mini apps are TRUSTED LOCAL CODE — imported in-process, not sandboxed. The enable toggle
 * is the security boundary; there is no isolation beyond it by design.
 *
 * The mini-app-facing CONTRACT (`MiniAppContext`, the hook and channel types) is OWNED by
 * `@localixai/mini-app-sdk/backend`; the host imports it from there.
 */

/**
 * Dynamic-import a native entrypoint and run its `register(ctx)`; failures propagate to the caller.
 * `register` is the one entry a backend has (the SDK's `MiniAppRegistration`): a module without it
 * contributes nothing.
 */
export async function importNativeModule(
  absPath: string,
  ctx: MiniAppContext,
): Promise<{
  tools: AgentTool[]
  hooks?: MiniAppHooks
  channels: MiniAppChannel[]
  memory?: MemoryProvider
  /** Process-global backend contributions from `register()` (empty unless it returns `backend`). */
  backends: BackendSubsystem[]
}> {
  const mod = (await importFreshModule(absPath)) as NativeModuleExports
  if (typeof mod.register !== 'function') return { tools: [], channels: [], backends: [] }
  const result = await mod.register(ctx)
  return {
    tools: asToolArray(result?.tools),
    hooks: result?.hooks,
    channels: asChannelArray(result?.channels),
    memory: asMemoryProvider(result?.memory),
    backends: asBackendSubsystemArray(result?.backend),
  }
}

/**
 * Import a discovered mini app's native entrypoints to read model/UI metadata from
 * its real AgentTool definitions. This DOES run the
 * mini app's module top-level, so callers must only invoke it for enabled mini apps
 * (the trust gate). Returns descriptors that would actually register (reserved/
 * invalid and duplicate names excluded) plus any import error.
 */
export async function inspectMiniAppTools(
  miniApp: DiscoveredMiniApp,
  config: MiniAppConfigValues,
  /**
   * The scope the inspection runs as; `homeDir` is where the mini app's roots live (see
   * `makeContext`).
   */
  runtime: { userId?: string; cwd?: string; host?: MiniAppHostServices; homeDir: string },
  logger?: { warn: (msg: string, meta?: unknown) => void },
): Promise<{
  tools: MiniAppToolDescriptor[]
  backendSubsystems: string[]
  routeMounts: string[]
  resourceProviders: string[]
  searchProviders: string[]
  contextProviders: string[]
  wsCommands: string[]
  channels: string[]
  error?: string
}> {
  const descriptors = new Map<string, MiniAppToolDescriptor>()
  const backendSubsystems: string[] = []
  const routeMounts: string[] = []
  const resourceProviders: string[] = []
  const searchProviders: string[] = []
  const contextProviders: string[] = []
  const wsCommands: string[] = []
  const channelNames: string[] = []
  let error: string | undefined
  // `register(ctx)` is expected to return invariant definitions, but it is ordinary
  // trusted mini app code and can still derive metadata from userId/cwd. Inspect with
  // the same scope context the runtime loader receives so Settings and the model do
  // not silently see different rosters for a context-sensitive mini app.
  const ctx = makeContext(
    miniApp.name,
    miniApp.dir,
    config,
    () => {},
    runtime.cwd ?? miniApp.dir,
    runtime.userId ?? 'local-user',
    runtime.homeDir,
    // A mini app whose contributions depend on a host SERVICE — one that isolates a workspace, say
    // — returns nothing without it, and inspecting it hostless reports a mini app that contributes
    // nothing rather than one that could not be asked. Callers that have a host pass it.
    runtime.host,
  )
  for (const entry of miniApp.backendEntries) {
    try {
      const { tools, backends, channels } = await importNativeModule(entry, ctx)
      channelNames.push(...channels.map((channel) => channel.name))
      for (const tool of tools) {
        if (!isAcceptableToolName(tool.name) || descriptors.has(tool.name)) continue
        descriptors.set(tool.name, {
          name: tool.name,
          label: tool.label?.trim() || tool.name,
          description: capMiniAppToolDescription(tool.description),
        })
      }
      for (const backend of backends) {
        backendSubsystems.push(backend.id)
        if (backend.routeMount) routeMounts.push(backend.routeMount.path)
        if (backend.resourceProvider) resourceProviders.push(backend.resourceProvider.provider)
        if (backend.searchProvider) searchProviders.push(backend.searchProvider.id)
        for (const contribution of backend.contextProviders ?? []) {
          contextProviders.push(contribution.provider.id)
        }
        for (const contribution of backend.wsFrames ?? []) {
          wsCommands.push(contribution.subscribeCommand, contribution.unsubscribeCommand)
        }
      }
    } catch (err) {
      const message = errorMessage(err)
      error = error ? `${error}; ${message}` : message
      logger?.warn(`mini app "${miniApp.name}" inspect failed for ${entry}`, {
        error: message,
      })
    }
  }
  return {
    tools: [...descriptors.values()],
    backendSubsystems: [...new Set(backendSubsystems)],
    routeMounts: [...new Set(routeMounts)],
    resourceProviders: [...new Set(resourceProviders)],
    searchProviders: [...new Set(searchProviders)],
    contextProviders: [...new Set(contextProviders)],
    wsCommands: [...new Set(wsCommands)],
    channels: [...new Set(channelNames)],
    error,
  }
}

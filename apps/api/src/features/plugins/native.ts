import { errorMessage } from '../../lib/errors'
import { importFreshModule } from '../../lib/module-url'

import type { AgentTool } from '@localixai/agent/agents'

import type { DiscoveredPlugin } from './discovery'
import type { MiniAppConfigValues } from './config'
import { capMiniAppToolDescription, isAcceptableToolName } from './tool-policy'
import type { MiniAppToolDescriptor } from './contracts'
import { isPlainObject } from './mcp'

import { makeContext } from './native-context'
export { makeContext } from './native-context'

/**
 * Native-plugin runtime: the context handed to a plugin's `register(ctx)`, the
 * dynamic-import of its entrypoint, and the structural shaping/validation of whatever
 * it exports into real AgentTools. Importing a module here RUNS its top-level code,
 * so callers must only do so for enabled plugins (the trust gate lives in the loader).
 *
 * Native plugins are TRUSTED LOCAL CODE — imported in-process, not sandboxed. The
 * enable toggle is the security boundary; there is no isolation beyond it by design.
 *
 * The plugin-facing CONTRACT (MiniAppContext + hook/channel types) is OWNED by
 * `@localixai/mini-app-sdk` — this module implements it and re-exports the types so
 * the historical `./native` import surface stays stable.
 */
import type { MiniAppContext, MiniAppHostServices } from '@localixai/mini-app-sdk/backend'
export type {
  MiniAppContext,
  MiniAppHostServices,
  MiniAppProblem,
} from '@localixai/mini-app-sdk/backend'

export { type MiniAppProblemSink } from './problem-reporter'

// Lifecycle-hook + memory-provider type contracts live in hook-contracts.ts; the
// values + types are re-exported here so the historical './native' import surface
// (hooks.ts, loader.ts, prompt-context.ts, finalize.ts, plugin tests) stays stable.
export {
  ASSISTANT_BINDINGS_MAX,
  ASSISTANT_BINDING_DATA_CAP_BYTES,
  MEMORY_CONTEXT_CAP_CHARS,
  MEMORY_TIMEOUT_MS,
} from './hook-contracts'
export type {
  AssistantMessageEvent,
  SubagentStopEvent,
  HitlRequestEvent,
  HitlResolvedEvent,
  HumanAssignedEvent,
  MiniAppHooks,
  MemoryLoadContextEvent,
  MemoryRunEndEvent,
  MemoryProvider,
} from './hook-contracts'

import type { MiniAppHooks, MemoryProvider } from './hook-contracts'

// ---------------------------------------------------------------------------
// Channels — long-running external conversation bridges.
// ---------------------------------------------------------------------------
// Type contracts live in channel-contracts.ts; re-exported here so the
// historical './native' import surface (channel-host, chat/service, loader, …)
// stays stable.
export type {
  ChannelRunEvent,
  ChannelInboundMessage,
  ChannelInboundResult,
  ChannelWorkspaceApi,
  ChannelContext,
  MiniAppChannel,
} from './channel-contracts'

import type { MiniAppChannel } from './channel-contracts'

// Structural coercion of a native module's register()/default/tools export into
// the real runtime shapes lives in native-coerce.ts.
import {
  asBackendSubsystemArray,
  asChannelArray,
  asMemoryProvider,
  asToolArray,
  looksLikeTool,
  type NativeModuleExports,
} from './native-coerce'
import type { BackendSubsystem } from '../ext/subsystem-contrib'

/** Dynamic-import a native entrypoint and extract its tools + hooks; failures propagate to the caller. */
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

  if (typeof mod.register === 'function') {
    const result = await mod.register(ctx)
    return {
      tools: asToolArray(result?.tools),
      hooks: result?.hooks ?? mod.hooks,
      channels: asChannelArray(result?.channels),
      memory: asMemoryProvider(result?.memory),
      backends: asBackendSubsystemArray(result?.backend),
    }
  }

  const def = mod.default
  if (def !== undefined) {
    if (Array.isArray(def) || looksLikeTool(def))
      return { tools: asToolArray(def), hooks: mod.hooks, channels: [], backends: [] }
    if (isPlainObject(def)) {
      return {
        tools: asToolArray(def.tools),
        hooks: (def.hooks as MiniAppHooks | undefined) ?? mod.hooks,
        channels: asChannelArray(def.channels),
        backends: [],
      }
    }
  }
  return { tools: asToolArray(mod.tools), hooks: mod.hooks, channels: [], backends: [] }
}

/**
 * Import a discovered plugin's native entrypoints to read model/UI metadata from
 * its real AgentTool definitions. This DOES run the
 * plugin's module top-level, so callers must only invoke it for enabled plugins
 * (the trust gate). Returns descriptors that would actually register (reserved/
 * invalid and duplicate names excluded) plus any import error.
 */
export async function inspectMiniAppTools(
  plugin: DiscoveredPlugin,
  config: MiniAppConfigValues,
  /** The scope the inspection runs as; `homeDir` is where the plugin's roots live (see `makeContext`). */
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
  // trusted plugin code and can still derive metadata from userId/cwd. Inspect with
  // the same scope context the runtime loader receives so Settings and the model do
  // not silently see different rosters for a context-sensitive plugin.
  const ctx = makeContext(
    plugin.manifest.name,
    plugin.dir,
    config,
    () => {},
    runtime.cwd ?? plugin.dir,
    runtime.userId ?? 'local-user',
    runtime.homeDir,
    // A plugin whose contributions depend on a host SERVICE — one that isolates a workspace, say —
    // returns nothing without it, and inspecting it hostless reports a plugin that contributes
    // nothing rather than one that could not be asked. Callers that have a host pass it.
    runtime.host,
  )
  for (const entry of plugin.entrypoints.toolEntries) {
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
      logger?.warn(`plugin "${plugin.manifest.name}" inspect failed for ${entry}`, {
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

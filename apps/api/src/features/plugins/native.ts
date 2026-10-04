import { mkdirSync } from 'node:fs'
import { errorMessage } from '../../lib/errors'
import { importFreshModule } from '../../lib/module-url'
import { resolveRuntimeAddress, resolveWebhookUrl } from '../../lib/runtime-address'

import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { isUiNavigationAction, isUiNavigationRequest } from '@localixai/plugin-sdk/ui'
import { makePluginOAuth } from './oauth'
import { pluginDataDir, pluginStateDir } from './mcp-substitute'

import type { DiscoveredPlugin } from './discovery'
import type { PluginConfigValues } from './config'
import { capPluginToolDescription, isAcceptableToolName } from './tool-policy'
import type { PluginToolDescriptor } from './contracts'
import { makeHelpers } from './native-helpers'
export { makeHelpers, type PluginHelpers } from './native-helpers'
import { isPlainObject } from './mcp'
import type { PluginProblemReporter } from './problem-reporter'

/**
 * Native-plugin runtime: the context handed to a plugin's `register(ctx)`, the
 * dynamic-import of its entrypoint, and the structural shaping/validation of whatever
 * it exports into real AgentTools. Importing a module here RUNS its top-level code,
 * so callers must only do so for enabled plugins (the trust gate lives in the loader).
 *
 * Native plugins are TRUSTED LOCAL CODE — imported in-process, not sandboxed. The
 * enable toggle is the security boundary; there is no isolation beyond it by design.
 *
 * The plugin-facing CONTRACT (PluginContext + hook/channel types) is OWNED by
 * `@localixai/plugin-sdk` — this module implements it and re-exports the types so
 * the historical `./native` import surface stays stable.
 */
import type {
  PluginContext,
  PluginHostServices,
  PluginUi,
  PluginUiDestination,
} from '@localixai/plugin-sdk/backend'
export type {
  PluginContext,
  PluginHostServices,
  PluginProblem,
  PluginRuntimeInfo,
} from '@localixai/plugin-sdk/backend'

function invalidPluginUiDestination(destination: PluginUiDestination): never {
  throw new Error(
    `Invalid plugin UI destination "${destination.uri}". Expected a canonical read-only localix://ui/... or localix://resource/... URI with a short label.`,
  )
}

export function makePluginUi(): PluginUi {
  return {
    open(destination) {
      const request = {
        type: 'ui.navigate.request' as const,
        ...destination,
        issuedAt: Date.now(),
      }
      return isUiNavigationRequest(request) ? request : invalidPluginUiDestination(destination)
    },
    offer(destination) {
      const action = { type: 'ui.navigate' as const, ...destination }
      return isUiNavigationAction(action) ? action : invalidPluginUiDestination(destination)
    },
  }
}

export {
  pluginProblemReporter,
  type PluginProblemReporter,
  type PluginProblemSink,
} from './problem-reporter'

/** Build the context object passed to a plugin's register()/hooks. `host` is the generic
 *  backend host-service seam — passed only on the boot-time backend load. */
export function makeContext(
  pluginName: string,
  pluginDir: string,
  config: PluginConfigValues,
  log: (message: string) => void,
  cwd: string,
  userId: string,
  /** The home the plugin's state and data roots live in — the one discovery was given. */
  home: string,
  host?: PluginHostServices,
  reportProblem?: PluginProblemReporter,
  /** The per-run load's session storage; the boot load already carries it in `host`. */
  sessionStorage?: PluginContext['sessionStorage'],
  /** The per-run load's agent directory; the boot load already carries it in `host`. */
  agents?: PluginContext['agents'],
): PluginContext {
  const stateDir = pluginStateDir(pluginName, home)
  const dataDir = pluginDataDir(pluginName, home)
  try {
    mkdirSync(stateDir, { recursive: true })
    mkdirSync(dataDir, { recursive: true })
  } catch {
    // unwritable home — the plugin will surface the error if it actually needs state
  }
  const address = resolveRuntimeAddress()
  return {
    userId,
    config,
    pluginDir,
    pluginName,
    log,
    // Bound to the plugin name here, so a plugin can only ever speak as itself. The
    // SESSION is not bound: this context is cached per scope and shared by a parent run
    // and its children, so the caller passes the session it is actually handling.
    ...(reportProblem ? { reportProblem: (problem) => reportProblem(pluginName, problem) } : {}),
    z,
    defineTool: defineAgentTool,
    cwd,
    // The user is bound HERE, from the plugin context, so a plugin can never read another user's
    // pane by passing an id. The session stays the caller's to supply — it comes from the hook or
    // tool call that is asking, and the host checks it owns the terminal.
    ...(host?.terminalRead
      ? {
          terminalRead: {
            screen: (input) => host.terminalRead!.screen({ userId, ...input }),
            finalScreen: (input) => host.terminalRead!.finalScreen({ userId, ...input }),
            list: (input) => host.terminalRead!.list({ userId, ...input }),
          },
        }
      : {}),
    ...(host?.watchPath ? { watchPath: host.watchPath } : {}),
    helpers: makeHelpers(),
    ui: makePluginUi(),
    oauth: makePluginOAuth(pluginName),
    stateDir,
    dataDir,
    // One folder per session on every load: routes (boot, through `host`) and tools (per run)
    // resolve the same place, so a tool and a route never disagree about a session's data.
    ...((host?.sessionStorage ?? sessionStorage)
      ? { sessionStorage: host?.sessionStorage ?? sessionStorage }
      : {}),
    // Same rule for the agent directory: a route and a tool resolve a name against one registry.
    ...((host?.agents ?? agents) ? { agents: host?.agents ?? agents } : {}),
    runtime: { ...address, webhookUrl: resolveWebhookUrl() },
    host,
  }
}

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
  PreToolCallEvent,
  PreToolCallHookResult,
  PostToolCallEvent,
  PostToolCallHookResult,
  UserMessageEvent,
  UserMessageHookResult,
  AssistantMessageEvent,
  AssistantMessageHookResult,
  SubagentStopEvent,
  HitlRequestEvent,
  HitlResolvedEvent,
  PluginHooks,
  MemoryLoadContextEvent,
  MemoryRunEndEvent,
  MemoryProvider,
} from './hook-contracts'

import type { PluginHooks, MemoryProvider } from './hook-contracts'

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
  ChannelSessionSummary,
  ChannelModelOption,
  ChannelWorkspaceApi,
  ChannelContext,
  PluginChannel,
} from './channel-contracts'

import type { PluginChannel } from './channel-contracts'

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

/** Dynamic-import a native entrypoint and extract its tools + hooks (never throws). */
export async function importNativeModule(
  absPath: string,
  ctx: PluginContext,
): Promise<{
  tools: AgentTool[]
  hooks?: PluginHooks
  channels: PluginChannel[]
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
        hooks: (def.hooks as PluginHooks | undefined) ?? mod.hooks,
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
export async function inspectPluginTools(
  plugin: DiscoveredPlugin,
  config: PluginConfigValues,
  /** The scope the inspection runs as; `homeDir` is where the plugin's roots live (see `makeContext`). */
  runtime: { userId?: string; cwd?: string; host?: PluginHostServices; homeDir: string },
  logger?: { warn: (msg: string, meta?: unknown) => void },
): Promise<{
  tools: PluginToolDescriptor[]
  backendSubsystems: string[]
  routeMounts: string[]
  resourceProviders: string[]
  searchProviders: string[]
  contextProviders: string[]
  wsCommands: string[]
  channels: string[]
  error?: string
}> {
  const descriptors = new Map<string, PluginToolDescriptor>()
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
          description: capPluginToolDescription(tool.description),
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

import type { AgentTool } from '@localixai/agent/agents'

import type { BackendSubsystem } from '../ext/subsystem-contrib'
import type { MemoryProvider, MiniAppChannel, MiniAppContext, MiniAppHooks } from './native'

/**
 * WHAT A MINI APP LOAD PRODUCES — the shape every consumer of `loadEnabledMiniApps` reads. Only
 * what mini apps contribute: a plugin's skills, MCP servers or hooks are never here, and a mini
 * app's tools are never in `LoadedPlugins` (docs/internals/plugins-and-mini-apps.md).
 */

export interface LoadedMiniAppHook {
  app: string
  hooks: MiniAppHooks
  ctx: MiniAppContext
}

export interface LoadedMiniApps {
  /** The agent tools enabled mini apps' backends register. */
  tools: AgentTool[]
  /** JavaScript lifecycle hooks, each bound to its app's context. */
  hooks: LoadedMiniAppHook[]
  /** Long-running platform channels; started by the channel host, not per turn. */
  channels: Array<{ app: string; channel: MiniAppChannel; ctx: MiniAppContext }>
  /** Declarative system-prompt sections (size-capped by schema). */
  promptSections: Array<{ app: string; title: string; content: string }>
  /** Each enabled mini app's guide, read on demand with `MiniAppGuide`. */
  guides: Array<{ app: string; file: string; pages?: string }>
  /** The active external memory provider, or null. At most one: the first enabled app wins. */
  memory: { app: string; provider: MemoryProvider; ctx: MiniAppContext } | null
  /**
   * Process-global backend subsystems, collected for the backend host (`backend-host.ts`), which
   * wires them at boot and on every enable and disable. `revision` is the import identity of the
   * code it came from, so a rebuilt backend is re-wired.
   */
  backends: Array<{ app: string; projectId: string; backend: BackendSubsystem; revision: string }>
  /** One line per enabled mini app, for diagnostics and the prompt's index. */
  loaded: Array<{
    name: string
    scope: 'global' | 'project'
    description: string
    toolNames: string[]
    error?: string
  }>
  /** Installed, waiting on a decision, deliberately not loaded. */
  awaitingConsent: string[]
}

/** A load with nothing in it: what a load starts from, and what a failed load degrades to. */
export function emptyLoadedMiniApps(): LoadedMiniApps {
  return {
    tools: [],
    hooks: [],
    channels: [],
    promptSections: [],
    guides: [],
    memory: null,
    backends: [],
    loaded: [],
    awaitingConsent: [],
  }
}

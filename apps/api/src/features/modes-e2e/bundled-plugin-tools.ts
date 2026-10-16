/**
 * The bundled plugins' tools, loaded the way the host loads them: discovered from the bundled
 * root, given the context `makeContext` builds, imported through `importNativeModule`.
 *
 * Not by importing a plugin's source: core may not name a concrete plugin's tree
 * (`scripts/check-architecture.mjs`), and a hand-built context would test a plugin under a shape
 * no host gives it. The defect this shape stops is a matrix that silently covers a different
 * roster from the one a run carries.
 *
 * A plugin is real code with real side effects: a backend singleton may start (external agents
 * reads other agents' history). Every backend's `onShutdown` is collected so the caller stops what
 * the load started, and the roots live in a temporary home the caller removes.
 */
import type { AgentTool } from '@localixai/agent/agents'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolvePluginConfig } from '../plugins/config'
import { discoverBundledPlugins } from '../plugins/discovery'
import { importNativeModule, makeContext } from '../plugins/native'

export interface LoadedBundledTools {
  tools: AgentTool[]
  /** `plugin: error` for every entrypoint that could not be imported. */
  failures: string[]
  dispose(): Promise<void>
}

export async function loadBundledPluginTools(workspace: string): Promise<LoadedBundledTools> {
  const home = mkdtempSync(join(tmpdir(), 'localix-modes-e2e-home-'))
  const tools: AgentTool[] = []
  const failures: string[] = []
  const shutdowns: Array<() => unknown> = []
  const plugins = (await discoverBundledPlugins()).filter(
    (plugin) => plugin.provides.hasNativeTools,
  )
  for (const plugin of plugins) {
    const ctx = makeContext(
      plugin.manifest.name,
      plugin.dir,
      resolvePluginConfig(plugin.manifest, undefined),
      () => {},
      workspace,
      'user-1',
      home,
    )
    for (const entry of plugin.entrypoints.toolEntries) {
      try {
        const loaded = await importNativeModule(entry, ctx)
        tools.push(...loaded.tools)
        for (const backend of loaded.backends)
          if (backend.onShutdown) shutdowns.push(backend.onShutdown)
      } catch (error) {
        failures.push(`${plugin.manifest.name}: ${String(error)}`)
      }
    }
  }
  return {
    tools,
    failures,
    async dispose() {
      for (const shutdown of shutdowns) await Promise.resolve(shutdown()).catch(() => undefined)
      rmSync(home, { recursive: true, force: true })
    },
  }
}

import type { LoadedMiniApps } from './loader-contract'

/**
 * A scope's load, minus the mini apps one agent may not use. The load answers for the whole scope
 * and is shared; an agent's `mini-app:<name>` denial is applied here, per run, so an app it cannot
 * reach contributes no tool, hook, section, guide or memory to its turn and is not listed to it.
 */
export function narrowLoadedMiniApps(loaded: LoadedMiniApps, denied: string[]): LoadedMiniApps {
  if (denied.length === 0) return loaded
  const out = new Set(denied)
  const deniedTools = new Set(
    loaded.loaded.filter((entry) => out.has(entry.name)).flatMap((entry) => entry.toolNames),
  )
  return {
    ...loaded,
    tools: loaded.tools.filter((tool) => !deniedTools.has(tool.name)),
    hooks: loaded.hooks.filter((entry) => !out.has(entry.app)),
    channels: loaded.channels.filter((entry) => !out.has(entry.app)),
    promptSections: loaded.promptSections.filter((entry) => !out.has(entry.app)),
    guides: loaded.guides.filter((entry) => !out.has(entry.app)),
    memory: loaded.memory && out.has(loaded.memory.app) ? null : loaded.memory,
    loaded: loaded.loaded.filter((entry) => !out.has(entry.name)),
  }
}

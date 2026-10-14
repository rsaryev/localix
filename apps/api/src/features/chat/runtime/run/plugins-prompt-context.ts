import { TOOL } from '../../../agent-core/tool-names'
import type { LoadedPlugins } from '../../../plugins/loader'

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Build a bounded provenance index, not a second copy of plugin manifests or tool schemas.
 * Contributions that are not model-actionable in this run (UI, commands, hooks, disabled
 * skills/roles) are deliberately absent.
 *
 * A plugin tool is counted as DIRECT only when it is on the wire; one deferral kept behind
 * `activate_tools` is counted as one to activate. The index used to call every built plugin
 * tool direct, beside a roster that listed tools the model had no schema for.
 */
export function buildPluginsPromptContext(
  loadedPlugins: LoadedPlugins,
  runtimeToolNames: readonly string[],
  /** Built for this run but kept off the wire behind `activate_tools`. */
  deferredToolNames: ReadonlySet<string> = new Set(),
): string | undefined {
  const available = new Set(runtimeToolNames)
  const summaries = loadedPlugins.loaded.flatMap((plugin) => {
    const parts: string[] = []
    const directTools = plugin.toolNames.filter((name) => available.has(name)).length
    if (directTools) parts.push(countLabel(directTools, 'direct tool'))
    const deferred = plugin.toolNames.filter((name) => deferredToolNames.has(name)).length
    if (deferred) parts.push(`${countLabel(deferred, 'tool')} to activate`)
    if (plugin.skills.length && available.has(TOOL.skill))
      parts.push(countLabel(plugin.skills.length, 'skill'))
    return parts.length ? [`- ${plugin.name} — ${parts.join('; ')}`] : []
  })

  const promptSections = loadedPlugins.promptSections.map(
    (section) => `## ${section.pluginName}: ${section.title}\n${section.content.trim()}`,
  )
  const blocks = [summaries.join('\n'), promptSections.join('\n\n')].filter(Boolean)
  return blocks.length ? blocks.join('\n\n') : undefined
}

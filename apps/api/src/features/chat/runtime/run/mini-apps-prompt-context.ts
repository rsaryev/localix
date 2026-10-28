import { TOOL } from '../../../agent-core/tool-names'
import type { LoadedMiniApps } from '../../../mini-apps/loader-contract'

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * The enabled mini apps, as a bounded index: each app's tools (direct when on the wire, or kept
 * behind `ToolSearch`), whether it has a guide to read with `MiniAppGuide`, and the prompt
 * sections apps declare. Plugins have their own index (`plugins-prompt-context.ts`).
 */
export function buildMiniAppsPromptContext(
  loadedMiniApps: LoadedMiniApps,
  runtimeToolNames: readonly string[],
  /** Built for this run but kept off the wire behind `ToolSearch`. */
  deferredToolNames: ReadonlySet<string> = new Set(),
): string | undefined {
  const available = new Set(runtimeToolNames)
  const guides = available.has(TOOL.MiniAppGuide)
    ? new Set(loadedMiniApps.guides.map((guide) => guide.app))
    : new Set<string>()
  const summaries = loadedMiniApps.loaded.flatMap((app) => {
    const parts: string[] = []
    const direct = app.toolNames.filter((name) => available.has(name)).length
    if (direct) parts.push(countLabel(direct, 'direct tool'))
    const deferred = app.toolNames.filter((name) => deferredToolNames.has(name)).length
    if (deferred) parts.push(`${countLabel(deferred, 'tool')} to activate`)
    if (guides.has(app.name)) parts.push('guide')
    return parts.length ? [`- ${app.name} — ${parts.join('; ')}`] : []
  })
  const guideNote = guides.size
    ? [
        `One marked "guide" has one: read it with \`${TOOL.MiniAppGuide}\` before you first use the app.`,
      ]
    : []
  const sections = loadedMiniApps.promptSections.map(
    (section) => `## ${section.app}: ${section.title}\n${section.content.trim()}`,
  )
  const blocks = [[...summaries, ...guideNote].join('\n'), sections.join('\n\n')].filter(Boolean)
  return blocks.length ? blocks.join('\n\n') : undefined
}

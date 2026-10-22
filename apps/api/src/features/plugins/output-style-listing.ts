import { z } from 'zod'

import type { PluginCatalog } from './catalog'
import { readLocalOutputStyles } from './output-style-files'
import { outputStyleCatalog, pluginOutputStyles } from './output-styles'

/**
 * The output styles one scope offers, for the person's default in Settings: the built-in styles,
 * the person's own, the project's (with a project scope) and the enabled plugins' — what
 * `/output-style` lists in a chat of that scope.
 */
export const outputStyleSummarySchema = z.object({
  /** What the setting stores: the style's exact name, `<plugin>:<name>` for a plugin's. */
  name: z.string(),
  source: z.enum(['builtin', 'user', 'project', 'plugin']),
  description: z.string(),
  /** A plugin style that applies whenever its plugin is enabled, over any choice. */
  forced: z.boolean(),
})
export const listOutputStylesResponseSchema = z.object({
  styles: z.array(outputStyleSummarySchema),
})
export type OutputStyleSummary = z.infer<typeof outputStyleSummarySchema>

export async function listScopeOutputStyles(
  deps: {
    catalogFor: (userId: string, projectId: string) => Promise<PluginCatalog>
    cwdFor: (userId: string, projectId: string) => Promise<string | null>
    homeDir: string
  },
  userId: string,
  projectId: string,
): Promise<{ styles: OutputStyleSummary[] }> {
  const [catalog, cwd] = await Promise.all([
    deps.catalogFor(userId, projectId),
    projectId ? deps.cwdFor(userId, projectId) : null,
  ])
  const local = await readLocalOutputStyles({ homeDir: deps.homeDir, cwd })
  const plugins = catalog.enabled.flatMap(({ plugin }) => pluginOutputStyles(plugin))
  return {
    styles: outputStyleCatalog({ plugins, ...local }).map((entry) => ({
      name: entry.fullName,
      source: entry.source,
      description: entry.style.description,
      forced: entry.source === 'plugin' && entry.style.forceForPlugin,
    })),
  }
}

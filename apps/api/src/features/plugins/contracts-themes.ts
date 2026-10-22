import { z } from 'zod'

/**
 * A color theme an enabled plugin contributes (Claude Code `themes/<slug>.json`), as the UI applies
 * it: the Localix appearance it starts from and the CSS custom properties it overrides
 * (`themes.ts` maps the Claude Code tokens). Listed in the capability snapshot.
 */
export const pluginThemeSpecSchema = z.object({
  /** `<plugin>:<slug>` — stable across reloads; what the device stores when it is chosen. */
  id: z.string(),
  pluginName: z.string(),
  /** The theme's own label (`name`, else its slug). */
  name: z.string(),
  base: z.enum(['dark', 'light']),
  /** CSS custom property (`--status-error`) → color. */
  overrides: z.record(z.string(), z.string()),
})
export type PluginThemeSpec = z.infer<typeof pluginThemeSpecSchema>

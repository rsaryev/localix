import { userHome } from '../../../../lib/env'
import { claudeCodeOutputStyle } from '../../../cc-settings/settings-files'
import { readLocalOutputStyles } from '../../../plugins/output-style-files'
import {
  activeOutputStyle,
  outputStyleCatalog,
  type NamedOutputStyle,
  type PluginOutputStyle,
} from '../../../plugins/output-styles'

/**
 * The output style a chat run speaks in. Claude Code sends the active style with every request of
 * the main conversation; a delegated child or a job runs its own prompt, so only a chat run asks.
 * The chat's own `/output-style` choice wins, then the person's default (`outputStyle` in
 * Settings), then `outputStyle` of the Claude Code settings for the folder; a plugin's `force-for-plugin` style wins over both while its plugin is enabled.
 */
export async function resolveRunOutputStyle(input: {
  /** The chat's choice: a style's full name, `default`, or null when it made none. */
  chosen: string | null | undefined
  /** The person's default across chats. */
  defaultStyle?: string | null
  pluginStyles: readonly PluginOutputStyle[]
  cwd?: string | null
  homeDir?: string
}): Promise<NamedOutputStyle | null> {
  // A forced plugin style needs no files read; neither does a chat with no style at all.
  const forced = activeOutputStyle(input.pluginStyles, null)
  if (forced) return forced
  const homeDir = input.homeDir ?? userHome()
  // Claude Code's `outputStyle` setting for the folder, when Localix has no default of its own.
  const defaultStyle =
    input.defaultStyle || claudeCodeOutputStyle({ homeDir, cwd: input.cwd ?? null })
  if (!input.chosen && !defaultStyle) return null
  const local = await readLocalOutputStyles({ homeDir, cwd: input.cwd })
  return activeOutputStyle(
    outputStyleCatalog({ plugins: input.pluginStyles, ...local }),
    input.chosen,
    defaultStyle,
  )
}
